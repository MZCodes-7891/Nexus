// Calendar with day, week, and month views, plus real scheduled reminders. Google events are shown read-only when that account is connected.
let calendarMode = 'month';
let calendarCursor = new Date();
let googleEvents = [];

function startOfDay(date) { const copy = new Date(date); copy.setHours(0, 0, 0, 0); return copy; }
function addDays(date, days) { const copy = new Date(date); copy.setDate(copy.getDate() + days); return copy; }
function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
function clockTime(value) { return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function calendarRange() {
    if (calendarMode === 'day') return [startOfDay(calendarCursor), addDays(startOfDay(calendarCursor), 1)];
    if (calendarMode === 'week') { const start = addDays(startOfDay(calendarCursor), -calendarCursor.getDay()); return [start, addDays(start, 7)]; }
    const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
    const start = addDays(first, -first.getDay());
    return [start, addDays(start, 42)];
}
function eventChip(event) {
    return h('button', { type: 'button', class: 'cal-event', dataset: { kind: event.kind, source: event.source || 'nexus' }, title: `${event.title} · ${clockTime(event.start)}`, text: `${clockTime(event.start)} ${event.title}`, onclick: clickEvent => { clickEvent.stopPropagation(); eventDialog(event); } });
}
function eventDialog(event, date) {
    if (event?.source === 'google') { modal(event.title, h('p', { class: 'muted', text: `${new Date(event.start).toLocaleString()} · from Google Calendar. Edit it in Google Calendar.` })); return; }
    const title = h('input', { type: 'text', value: event?.title || '', maxlength: 160 });
    const startValue = event ? new Date(event.seriesStart || event.start) : date ? new Date(new Date(date).setHours(9, 0, 0, 0)) : null;
    const pad = value => String(value).padStart(2, '0');
    const start = h('input', { type: 'text', value: startValue ? `${startValue.getFullYear()}-${pad(startValue.getMonth() + 1)}-${pad(startValue.getDate())} ${pad(startValue.getHours())}:${pad(startValue.getMinutes())}` : '', placeholder: 'Friday at 3 PM' });
    const kind = h('select', {}, [['event', 'Event'], ['study', 'Study session'], ['assignment', 'Assignment'], ['test', 'Test']].map(([value, text]) => h('option', { value, text, selected: event?.kind === value })));
    const repeat = h('select', { 'aria-label': 'Repeats' }, [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Every week'], ['monthly', 'Every month']].map(([value, text]) => h('option', { value, text, selected: (event?.repeat || 'none') === value })));
    const notes = h('textarea', { rows: 3 }); notes.value = event?.notes || '';
    const google = h('input', { type: 'checkbox', style: 'width:auto', 'aria-label': 'Also add to Google Calendar' });
    const actions = [{ label: 'Cancel' }, { label: 'Save', primary: true, run: async () => {
        if (event) await call('calendar:update', event.id, { title: title.value, start: start.value, kind: kind.value, repeat: repeat.value, notes: notes.value });
        else {
            const saved = await call('calendar:add', { title: title.value, start: start.value, kind: kind.value, repeat: repeat.value, notes: notes.value, google: google.checked });
            if (saved.google) toast(saved.google.message, saved.google.ok ? 'ok' : 'error');
        }
        renderCalendar();
    } }];
    if (event) actions.unshift({ label: event.repeating ? 'Delete all repeats' : 'Delete', danger: true, run: async () => { await call('calendar:remove', event.id); renderCalendar(); } });
    modal(event ? 'Edit event' : 'Add event', h('div', {}, h('label', { text: 'Title' }), title, h('label', { text: 'When' }), start, event?.repeating ? h('p', { class: 'muted small', text: 'This is a repeating event. Changes apply to every date, and When is its first date.' }) : null, h('label', { text: 'Type' }), kind, h('label', { text: 'Repeats' }), repeat, h('label', { text: 'Notes' }), notes, event ? null : h('label', { class: 'row', style: 'margin-top:12px' }, google, h('span', { text: 'Also add to Google Calendar' }))), actions);
}
async function renderCalendar() {
    const [from, to] = calendarRange();
    const saved = await ipcRenderer.invoke('calendar:list', { from: from.toISOString(), to: to.toISOString() });
    const events = [...(Array.isArray(saved) ? saved : []), ...googleEvents.filter(event => { const at = new Date(event.start); return at >= from && at < to; })].sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const on = day => events.filter(event => sameDay(new Date(event.start), day));
    const today = new Date();
    const grid = document.getElementById('calendar-grid');
    document.getElementById('calendar-title').textContent = calendarMode === 'day' ? calendarCursor.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : calendarMode === 'week' ? `Week of ${from.toLocaleDateString([], { month: 'long', day: 'numeric' })}` : calendarCursor.toLocaleDateString([], { month: 'long', year: 'numeric' });
    document.querySelectorAll('#calendar-modes .tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === calendarMode));
    if (calendarMode === 'month') {
        const cells = Array.from({ length: 42 }, (_, index) => addDays(from, index));
        grid.replaceChildren(h('div', { class: 'cal-month' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => h('div', { class: 'cal-head', text: day })), cells.map(day => h('div', { class: `cal-cell${day.getMonth() !== calendarCursor.getMonth() ? ' other' : ''}${sameDay(day, today) ? ' today' : ''}`, onclick: () => eventDialog(null, day) }, h('div', { class: 'cal-date', text: String(day.getDate()) }), on(day).slice(0, 3).map(eventChip), on(day).length > 3 ? h('div', { class: 'muted small', text: `+${on(day).length - 3} more` }) : null))));
    } else if (calendarMode === 'week') {
        const days = Array.from({ length: 7 }, (_, index) => addDays(from, index));
        grid.replaceChildren(h('div', { class: 'cal-week' }, days.map(day => h('div', { class: `cal-day-col${sameDay(day, today) ? ' today' : ''}`, onclick: () => eventDialog(null, day) }, h('div', { class: 'cal-head', text: day.toLocaleDateString([], { weekday: 'short', day: 'numeric' }) }), on(day).map(eventChip)))));
    } else {
        const list = on(calendarCursor);
        grid.replaceChildren(h('div', { class: 'doc-list' }, list.length ? list.map(event => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('button', { type: 'button', class: 'link-like doc-title', text: event.title, onclick: () => eventDialog(event) }), h('div', { class: 'doc-meta', text: `${clockTime(event.start)} · ${event.kind}${event.notes ? ` · ${event.notes}` : ''}` })))) : emptyState('Nothing on this day.')));
    }
    renderReminders();
    const week = await ipcRenderer.invoke('calendar:week-summary');
    const summary = document.getElementById('calendar-week');
    if (summary && week.ok !== false) summary.textContent = week.events ? `This week: ${week.hours} hours booked, ${week.studyHours} of them studying. Busiest day: ${week.busiestDay}.` : 'Nothing booked this week.';
}
function findTimeDialog() {
    const what = h('input', { type: 'text', value: 'Study session', maxlength: 160, 'aria-label': 'What for' });
    const minutes = h('select', { 'aria-label': 'How long' }, [30, 45, 60, 90, 120].map(value => h('option', { value, text: `${value} minutes`, selected: value === 45 })));
    const results = h('div', { class: 'doc-list' });
    const search = async () => {
        const found = await call('calendar:suggest-times', { minutes: Number(minutes.value), busy: googleEvents });
        results.replaceChildren(h('p', { class: 'muted small', text: found.reason }), ...(found.slots.length ? found.slots.map(slot => h('div', { class: 'doc-row' }, h('div', { class: 'grow', text: new Date(slot.start).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }), h('button', { type: 'button', class: 'mini-button', text: 'Add', onclick: async () => { try { await call('calendar:add', { title: what.value, start: slot.start, minutes: Number(minutes.value), kind: 'study' }); toast('Added to your calendar.', 'ok'); dialog.close(); renderCalendar(); } catch (error) { toast(error.message, 'error'); } } }))) : [emptyState('No open time in the next week.')]));
    };
    minutes.addEventListener('change', search);
    const dialog = modal('Find a time', h('div', {}, h('label', { text: 'What for' }), what, h('label', { text: 'How long' }), minutes, results));
    search().catch(error => toast(error.message, 'error'));
}
async function renderReminders() {
    const list = await ipcRenderer.invoke('reminders:list');
    if (!Array.isArray(list)) return;
    const scheduled = list.filter(item => item.status === 'scheduled').sort((a, b) => a.at.localeCompare(b.at));
    document.getElementById('reminder-list').replaceChildren(...(scheduled.length ? scheduled.map(item => h('div', { class: 'doc-row' }, h('div', { class: 'grow' }, h('div', { class: 'doc-title', text: item.text }), h('div', { class: 'doc-meta', text: `${new Date(item.at).toLocaleString()}${item.repeat !== 'none' ? ` · repeats ${item.repeat}` : ''}` })), h('button', { type: 'button', class: 'mini-button danger', text: 'Delete', onclick: async () => { await call('reminders:remove', item.id); renderReminders(); } }))) : [emptyState('No reminders scheduled. Nexus must be running or in the tray for them to appear on time; missed ones show at next start.')]));
}
function bindCalendar() {
    document.getElementById('calendar-modes').replaceChildren(...[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([id, label]) => h('button', { type: 'button', class: 'tab', dataset: { tab: id }, text: label, onclick: () => { calendarMode = id; renderCalendar(); } })));
    const move = direction => { calendarCursor = calendarMode === 'month' ? new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + direction, 1) : addDays(calendarCursor, direction * (calendarMode === 'week' ? 7 : 1)); renderCalendar(); };
    document.getElementById('calendar-prev').addEventListener('click', () => move(-1));
    document.getElementById('calendar-next').addEventListener('click', () => move(1));
    document.getElementById('calendar-today').addEventListener('click', () => { calendarCursor = new Date(); renderCalendar(); });
    document.getElementById('calendar-add').addEventListener('click', () => eventDialog(null, calendarCursor));
    document.getElementById('calendar-add').after(h('button', { type: 'button', id: 'calendar-find-time', class: 'integration-button secondary', text: 'Find a time', onclick: findTimeDialog }));
    document.getElementById('calendar-grid').before(h('div', { id: 'calendar-week', class: 'muted small status-line', role: 'status' }));
    document.getElementById('calendar-sync').addEventListener('click', async () => {
        setLine('calendar-subtitle', 'Asking Google Calendar…');
        const result = await ipcRenderer.invoke('calendar:google-sync');
        if (result.ok) { googleEvents = result.events; setLine('calendar-subtitle', `Showing ${result.events.length} Google Calendar events.`); renderCalendar(); }
        else setLine('calendar-subtitle', result.message, 'error');
    });
    document.getElementById('reminder-form').addEventListener('submit', async event => {
        event.preventDefault();
        try {
            const reminder = await call('reminders:add', { text: document.getElementById('reminder-text').value, when: document.getElementById('reminder-when').value, repeat: document.getElementById('reminder-repeat').value });
            setLine('reminder-status', `Scheduled for ${new Date(reminder.at).toLocaleString()}.`, 'ok');
            document.getElementById('reminder-text').value = ''; document.getElementById('reminder-when').value = '';
            renderReminders();
        } catch (error) { setLine('reminder-status', error.message, 'error'); }
    });
    PAGE_HOOKS.calendar = renderCalendar;
    PAGE_HOOKS.calendarChanged = () => { if (!document.getElementById('view-calendar').classList.contains('hidden')) renderCalendar(); };
}
