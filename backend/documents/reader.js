const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { runPythonJson } = require('../core/python');

// Text recognition built into Windows, so scanned pages need no extra download and stay on this computer.
const OCR_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]|Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]|Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]|Out-Null
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1'})[0]
function Wait-Op($operation,[Type]$type){$task=$asTask.MakeGenericMethod($type).Invoke($null,@($operation));$task.Wait(-1)|Out-Null;$task.Result}
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if(-not $engine){throw 'Windows has no text recognition language installed.'}
$out=@()
foreach($path in (Get-Content -LiteralPath $env:NEXUS_OCR_LIST)){
  $file=Wait-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $stream=Wait-Op ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder=Wait-Op ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap=Wait-Op ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result=Wait-Op ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $out+=@{file=$path.ToString();text=[string]$result.Text}
  $stream.Dispose()
}
ConvertTo-Json -InputObject @($out) -Compress
`;

function recognize(files) {
  return new Promise((resolve, reject) => {
    const listFile = path.join(path.dirname(files[0]), 'files.txt');
    fs.writeFileSync(listFile, files.join('\n'));
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', OCR_SCRIPT], { windowsHide: true, timeout: 600000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, NEXUS_OCR_LIST: listFile } }, (error, stdout, stderr) => {
      try { resolve(JSON.parse(String(stdout).trim())); }
      catch { reject(new Error(String(stderr || error?.message || 'Text recognition failed.').split(/\r?\n/)[0].slice(0, 300))); }
    });
  });
}

// Reads text from page images and returns { page: text }, reporting pages it couldn't handle.
async function ocrPages(rootDir, filePath, pages) {
  const folder = path.join(os.tmpdir(), `nexus-ocr-${crypto.randomUUID()}`);
  await fs.promises.mkdir(folder, { recursive: true });
  try {
    const found = await runPythonJson(rootDir, 'pdf_images.py', [filePath, folder, pages === 'all' ? 'all' : pages.join(',')], { timeout: 300000 });
    if (!found.images.length) return { texts: {}, unreadable: found.unreadable, pages: found.pages };
    const results = await recognize(found.images.map(image => image.file));
    const byFile = new Map(results.map(item => [item.file, item.text]));
    const texts = {};
    for (const image of found.images) { const text = String(byFile.get(image.file) || '').trim(); if (text) texts[image.page] = text; }
    return { texts, unreadable: found.unreadable, pages: found.pages };
  } finally { await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {}); }
}

function mergePages(text, additions, limit) {
  const blocks = [];
  for (const match of String(text || '').matchAll(/\[PDF PAGE (\d+)\]\n([\s\S]*?)(?=\n*\[PDF PAGE \d+\]\n|\s*$)/g)) blocks.push({ page: Number(match[1]), text: match[2] });
  for (const [page, value] of Object.entries(additions)) blocks.push({ page: Number(page), text: value });
  const merged = blocks.sort((a, b) => a.page - b.page).map(block => `[PDF PAGE ${block.page}]\n${block.text}`).join('\n\n');
  return { text: merged.slice(0, limit), truncated: merged.length > limit };
}

async function readPdf(rootDir, filePath, limit) {
  let pdf;
  let scannedOnly = false;
  try { pdf = await runPythonJson(rootDir, 'pdf_text_extract.py', [filePath, limit], { timeout: 120000 }); }
  catch (error) {
    if (!/No selectable text/.test(error.message)) throw error;
    scannedOnly = true;
    pdf = { text: '', pages: 0, blankPages: [], textPages: 0, truncated: false, notProcessedPages: [] };
  }
  if (!scannedOnly && !pdf.blankPages?.length) return pdf;
  let scan;
  try { scan = await ocrPages(rootDir, filePath, scannedOnly ? 'all' : pdf.blankPages); }
  catch (error) {
    if (scannedOnly) throw new Error(`This PDF is scanned, and its pages could not be read: ${error.message}`);
    return pdf;
  }
  const recognized = Object.keys(scan.texts).map(Number);
  if (scannedOnly && !recognized.length) throw new Error('This PDF is scanned, and no text could be recognized in its pages.');
  const merged = mergePages(pdf.text, scan.texts, limit);
  const total = scan.pages || pdf.pages;
  const blank = (scannedOnly ? Array.from({ length: total }, (_, index) => index + 1) : pdf.blankPages).filter(page => !recognized.includes(page));
  return { ...pdf, text: merged.text, truncated: pdf.truncated || merged.truncated, pages: total, blankPages: blank, ocrPages: recognized, textPages: (pdf.textPages || 0) + recognized.length };
}

// Old-format .doc files can only be opened by Word itself. It is opened read-only and hidden.
function readWordDoc(filePath, limit) {
  const script = "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;$w=New-Object -ComObject Word.Application;try{$w.Visible=$false;$w.DisplayAlerts=0;$d=$w.Documents.Open($env:NEXUS_DOC,$false,$true);$t=$d.Content.Text;$d.Close(0);ConvertTo-Json -InputObject @{text=$t} -Compress}finally{$w.Quit()}";
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 120000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, NEXUS_DOC: filePath } }, (error, stdout) => {
      try { const text = String(JSON.parse(String(stdout).trim()).text || '').replace(/\r/g, '\n'); resolve({ text: text.slice(0, limit), truncated: text.length > limit }); }
      catch { reject(new Error('Older .doc files need Microsoft Word to read. Without Word, save the file as .docx and add it again.')); }
    });
  });
}

// One way to read any supported file, used by chat attachments, the library, and D2L.
function readDocument(rootDir, filePath, limit = 4000000) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.pdf') return readPdf(rootDir, filePath, limit);
  if (extension === '.doc') return readWordDoc(filePath, limit);
  return runPythonJson(rootDir, 'document_extract.py', [filePath, limit], { timeout: 180000 });
}

module.exports = { readDocument, ocrPages, mergePages };
