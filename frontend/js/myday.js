// My Day: the timed plan for today on Home. Work blocks can be marked done or skipped; Re-plan fits what's left into
// the time left. The routine (wake, bed, school, meals) is set in a window.
const DAY_KIND = { school: '🏫', event: '📅', prayer: '🕌', routine: '🍽', break: '☕', assignment: '📝', test: '🎯', task: '✅', study: '📚', quran: '📖' };
const clockText = value => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
let myDayHost = null;

function myDayCard() {
    myDayHost = h('section', { class: 'home-card myday-card' }, h('h3', { text: 'My day' }), h('p', { class: 'muted small', text: 'Planning your day…' }));
    ipcRenderer.invoke('day:get').then(drawMyDay).catch(error => myDayHost.replaceChildren(h('h3', { text: 'My day' }), emptyState(error.message)));
    return myDayHost;
}
function drawMyDay(plan, { tomorrow = false } = {}) {
    if (!myDayHost || !plan) return;
    const now = Date.now();
    const isWork = block => !['school', 'routine', 'event', 'prayer', 'break'].includes(block.kind);
    const work = plan.blocks.filter(isWork);
    const done = work.filter(block => block.status === 'done').length;
    const visible = tomorrow ? plan.blocks : plan.blocks.filter(block => new Date(block.end).getTime() > now - 30 * 60000 || block.status !== 'planned');
    const row = block => {
        const current = !tomorrow && new Date(block.start).getTime() <= now && new Date(block.end).getTime() > now;
        return h('div', { class: `myday-block kind-${block.kind}${current ? ' now' : ''}${block.status !== 'planned' ? ` ${block.status}` : ''}` },
            h('span', { class: 'myday-time', text: `${clockText(block.start)}–${clockText(block.end)}` }),
            h('span', { class: 'myday-icon', text: DAY_KIND[block.kind] || '•' }),
            h('div', { class: 'grow' }, h('div', { class: 'myday-title', text: block.title }), block.detail ? h('div', { class: 'muted small', text: block.detail }) : null),
            current ? h('span', { class: 'myday-badge', text: 'now' }) : null,
            !tomorrow && isWork(block) && block.status === 'planned' ? h('div', { class: 'row' },
                block.action ? h('button', { type: 'button', class: 'mini-button', text: 'Start', onclick: () => nowAction(block.action) }) : null,
                h('button', { type: 'button', class: 'mini-button', text: '✓', title: 'Done', onclick: () => call('day:mark', { day: plan.day, id: block.id, status: 'done' }).then(drawMyDay).catch(error => toast(error.message, 'error')) }),
                h('button', { type: 'button', class: 'mini-button', text: 'Skip', onclick: () => call('day:mark', { day: plan.day, id: block.id, status: 'skipped' }).then(drawMyDay).catch(error => toast(error.message, 'error')) })) : null,
            !tomorrow && block.status !== 'planned' && isWork(block) ? h('button', { type: 'button', class: 'link-like', text: 'undo', onclick: () => call('day:mark', { day: plan.day, id: block.id, status: 'planned' }).then(drawMyDay) }) : null);
    };
    const replan = h('button', { type: 'button', class: 'mini-button', text: '↻ Re-plan' });
    replan.addEventListener('click', busyButton(replan, 'Planning…', async () => drawMyDay(await call('day:plan', {}))));
    const other = h('button', { type: 'button', class: 'mini-button', text: tomorrow ? '← Today' : 'Tomorrow →', onclick: async () => { try { drawMyDay(tomorrow ? await call('day:get') : await call('day:plan', { tomorrow: true }), { tomorrow: !tomorrow }); } catch (error) { toast(error.message, 'error'); } } });
    myDayHost.replaceChildren(
        h('div', { class: 'myday-head' },
            h('h3', { text: tomorrow ? 'Tomorrow' : 'My day' }),
            !tomorrow && work.length ? h('div', { class: 'myday-progress', title: `${done} of ${work.length} done` }, h('div', { style: `width:${Math.round(done / work.length * 100)}%` })) : null,
            !tomorrow && work.length ? h('span', { class: 'muted small', text: `${done} of ${work.length} done` }) : null,
            h('div', { class: 'row wrap' },
                tomorrow ? null : h('button', { type: 'button', class: 'mini-button', text: '+ Add', onclick: addToDayWindow }),
                tomorrow ? null : replan, other,
                h('button', { type: 'button', class: 'mini-button', text: '⚙ Routine', onclick: routineWindow }))),
        visible.length ? h('div', { class: 'myday-list' }, ...visible.map(row)) : emptyState(tomorrow ? 'Nothing planned for tomorrow yet.' : 'Nothing left today. Add something, or enjoy the free time.'),
        plan.notFitted?.length ? h('p', { class: 'muted small', text: `Didn't fit${tomorrow ? '' : ' today'}: ${plan.notFitted.map(item => `${item.title} (${item.minutes} min)`).join(', ')}.` }) : null);
}
function addToDayWindow() {
    const title = h('input', { class: 'field', placeholder: 'Practise piano, finish lab report…', 'aria-label': 'What to do' });
    const minutes = selectBox([['15', '15 min'], ['30', '30 min'], ['45', '45 min'], ['60', '1 hour'], ['90', '1½ hours'], ['120', '2 hours']], '30', () => {});
    const important = h('input', { type: 'checkbox' });
    modal('Add to my day', h('div', { class: 'study-form' }, title, h('label', { class: 'muted small', text: 'How long it takes' }), minutes, h('label', { class: 'muted small row' }, important, 'Do this first')), [
        { label: 'Cancel' },
        { label: 'Add', primary: true, run: async () => { if (!title.value.trim()) { toast('Say what to add.', 'error'); return false; } drawMyDay(await call('day:add', { title: title.value.trim(), minutes: Number(minutes.value), important: important.checked })); toast('Added and re-planned.', 'ok'); } }]);
}
async function routineWindow() {
    const routine = await call('day:routine');
    const time = (value, label) => h('input', { class: 'field', type: 'time', value, 'aria-label': label });
    const wake = time(routine.wake, 'Wake up'); const bed = time(routine.bed, 'Bedtime');
    const schoolOn = h('input', { type: 'checkbox', checked: routine.school.on });
    const schoolStart = time(routine.school.start, 'School starts'); const schoolEnd = time(routine.school.end, 'School ends');
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayBoxes = DAYS.map((name, index) => { const box = h('input', { type: 'checkbox', checked: routine.school.days.includes(index) }); return { index, box, label: h('label', { class: 'row small' }, box, name) }; });
    const rows = h('div', { class: 'myday-routine' });
    const addRow = (item = { title: '', time: '18:00', minutes: 30 }) => {
        const title = h('input', { class: 'field', value: item.title, placeholder: 'Dinner, practice, chores…', 'aria-label': 'Routine' });
        const at = time(item.time, 'At'); const length = h('input', { class: 'field', type: 'number', min: 5, max: 240, value: item.minutes, style: 'width:80px', 'aria-label': 'Minutes' });
        const row = h('div', { class: 'row' }, title, at, length, h('span', { class: 'muted small', text: 'min' }), h('button', { type: 'button', class: 'link-like', text: 'remove', onclick: () => row.remove() }));
        row.read = () => ({ title: title.value.trim(), time: at.value, minutes: Number(length.value), days: item.days });
        rows.append(row);
    };
    routine.routine.forEach(addRow);
    const alerts = h('input', { type: 'checkbox', checked: routine.alerts });
    const block = selectBox([['30', '30 min'], ['45', '45 min'], ['60', '60 min']], String(routine.block), () => {});
    modal('My routine', h('div', { class: 'study-form' },
        h('div', { class: 'row' }, h('label', { class: 'coach-field' }, h('span', { class: 'muted small', text: 'Wake up' }), wake), h('label', { class: 'coach-field' }, h('span', { class: 'muted small', text: 'Bedtime' }), bed)),
        h('label', { class: 'muted small row' }, schoolOn, 'School'),
        h('div', { class: 'row wrap' }, schoolStart, h('span', { class: 'muted small', text: 'to' }), schoolEnd, ...dayBoxes.map(item => item.label)),
        h('b', { text: 'Every day' }), rows,
        h('button', { type: 'button', class: 'mini-button', text: '+ Add a routine', onclick: () => addRow() }),
        h('label', { class: 'muted small', text: 'Longest work block before switching' }), block,
        h('label', { class: 'muted small row' }, alerts, 'Tell me when each block starts (and on my phone, if it\'s linked)')), [
        { label: 'Cancel' },
        { label: 'Save', primary: true, run: async () => {
            await call('day:routine-set', { wake: wake.value, bed: bed.value, school: { on: schoolOn.checked, start: schoolStart.value, end: schoolEnd.value, days: dayBoxes.filter(item => item.box.checked).map(item => item.index) }, routine: [...rows.children].map(row => row.read()).filter(item => item.title), block: Number(block.value), alerts: alerts.checked });
            drawMyDay(await call('day:get'));
            toast('Routine saved and the day re-planned.', 'ok');
        } }]);
}
ipcRenderer.on('day:changed', (_event, plan) => { if (myDayHost && document.body.contains(myDayHost)) drawMyDay(plan); });
