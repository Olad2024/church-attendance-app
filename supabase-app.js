(() => {
  const config = window.SUPABASE_CONFIG || {};
  const authScreen = document.querySelector('#authScreen');
  const loginForm = document.querySelector('#loginForm');
  const authError = document.querySelector('#authError');
  const setupMessage = document.querySelector('#setupMessage');
  let db = null;
  let sessionUser = null;
  let userProfile = null;

  const configured = Boolean(config.url && config.anonKey && window.supabase?.createClient);
  if (!configured) {
    loginForm.hidden = true;
    setupMessage.hidden = false;
    return;
  }

  db = window.supabase.createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const serviceFromDb = row => ({
    id: row.id, date: row.service_date, type: row.service_type, topic: row.topic,
    speaker: row.speaker, men: row.men, women: row.women, youth: row.youth,
    children: row.children, campus: row.campus, visitors: row.visitors,
    offering: Number(row.offering || 0), endTime: row.end_time || '', notes: row.notes,
    attendees: row.attendees || [], source: row.source || ''
  });

  const personFromDb = row => ({
    id: row.id, name: row.full_name, type: row.person_type, group: row.group_name,
    phone: row.phone, email: row.email, lastSeen: row.last_seen,
    status: row.connection_status, notes: row.notes
  });

  const personToDb = item => ({
    full_name: item.name, person_type: item.type, group_name: item.group,
    phone: item.phone || '', email: item.email || '', last_seen: item.lastSeen || null,
    connection_status: item.status || 'Connected', notes: item.notes || ''
  });

  function emptyDatabaseMessage() {
    const historyCount = (window.OW_HISTORY || []).length;
    const rosterCount = (window.OW_PEOPLE_HISTORY || []).length;
    const isAdmin = userProfile?.role === 'admin';
    return `<article class="card empty-database-card">
      <p class="kicker">DATABASE READY</p>
      <h3>Your Supabase database is connected, but it has no church records yet.</h3>
      <p>The app still has your prepared local records: <strong>${historyCount} service records</strong> and <strong>${rosterCount} people</strong>. Import them once to copy the data into Supabase for your team.</p>
      ${isAdmin ? '<button class="btn btn-primary" data-import-history>Import historical records now</button>' : '<p><strong>Ask an administrator</strong> to open Team & roles and click “Import historical records.”</p>'}
    </article>`;
  }

  const serviceToDb = item => ({
    service_date: item.date, service_type: item.type, topic: item.topic || '',
    speaker: item.speaker || '', men: Number(item.men || 0), women: Number(item.women || 0),
    youth: Number(item.youth || 0), children: Number(item.children || 0),
    campus: Number(item.campus || 0), visitors: Number(item.visitors || 0),
    offering: Number(item.offering || 0), end_time: item.endTime || null,
    attendees: item.attendees || [], notes: item.notes || '', source: item.source || null
  });

  async function saveRegisterPeople(attendees, serviceDate) {
    for (const attendee of attendees || []) {
      const existing = people.find(person =>
        String(person.id) === String(attendee.id) ||
        person.name.trim().toLowerCase() === attendee.name.trim().toLowerCase()
      );
      if (existing) {
        attendee.id = existing.id;
        await db.from('people').update({
          last_seen: serviceDate,
          group_name: attendee.group || existing.group,
          person_type: attendee.type || existing.type,
          connection_status: (attendee.type || existing.type) === 'Visitor' ? 'Follow-up' : existing.status || 'Connected'
        }).eq('id', existing.id);
      } else {
        const payload = {
          full_name: attendee.name,
          person_type: attendee.type || 'Member',
          group_name: attendee.group || 'Men',
          phone: '',
          email: '',
          last_seen: serviceDate,
          connection_status: attendee.type === 'Visitor' ? 'Follow-up' : 'Connected',
          notes: 'Added from attendance register'
        };
        const { data, error } = await db.from('people').insert(payload).select().single();
        if (error) throw error;
        attendee.id = data.id;
      }
    }
  }

  async function syncRoster(roster) {
    const existingResult = await db.from('people').select('full_name');
    if (existingResult.error) throw existingResult.error;
    const existingNames = new Set((existingResult.data || []).map(person => person.full_name.trim().toLowerCase()));
    const missingRoster = roster.filter(person => !existingNames.has(person.full_name.trim().toLowerCase()));
    for (let index = 0; index < missingRoster.length; index += 100) {
      const { error } = await db.from('people').insert(missingRoster.slice(index, index + 100));
      if (error) throw error;
    }
    return missingRoster.length;
  }

  async function syncServices(history) {
    const existingResult = await db.from('services').select('service_date,service_type,topic');
    if (existingResult.error) throw existingResult.error;
    const serviceKey = service => `${service.service_date}|${service.service_type}|${service.topic || ''}`.trim().toLowerCase();
    const existingKeys = new Set((existingResult.data || []).map(serviceKey));
    const missingHistory = history.filter(service => !existingKeys.has(serviceKey(service)));
    for (let index = 0; index < missingHistory.length; index += 100) {
      const { error } = await db.from('services').insert(missingHistory.slice(index, index + 100));
      if (error) throw error;
    }
    return missingHistory.length;
  }

  function renderSharedViews() {
    if (services.length) { renderAll(); return; }
    document.querySelector('#statsGrid').innerHTML = ['Active people','Average attendance','Visitors welcomed','Follow-ups due'].map((label, index) => `<article class="stat-card"><small>${label}</small><strong>${index === 0 ? people.length : index === 3 ? people.filter(person => person.status === 'Follow-up').length : 0}</strong><span>Shared database</span></article>`).join('');
    document.querySelector('#attendanceChart').innerHTML = '<text x="380" y="120" text-anchor="middle" font-size="13" fill="currentColor" opacity=".55">No attendance records yet</text>';
    document.querySelector('#recentServices').innerHTML = emptyDatabaseMessage();
    renderFollow(); renderAttendance(); renderPeople(); renderReports();
    document.querySelector('#attendanceRecords').innerHTML = emptyDatabaseMessage();
    document.querySelector('#reportRows').innerHTML = `<tr><td colspan="8">${emptyDatabaseMessage()}</td></tr>`;
    if (!people.length) document.querySelector('#peopleRows').innerHTML = `<tr><td colspan="6">${emptyDatabaseMessage()}</td></tr>`;
  }

  async function importHistoricalRecords(button) {
    if (userProfile?.role !== 'admin') return;
    button.disabled = true; button.textContent = 'Importing...';
    try {
      const history = (window.OW_HISTORY || []).map(serviceToDb);
      const addedServices = await syncServices(history);
      const roster = (window.OW_PEOPLE_HISTORY || []).map(personToDb);
      const addedPeople = await syncRoster(roster);
      await loadSharedData();
      showToast(`${addedServices} services and ${addedPeople} people added`);
    } catch (error) { showToast(error.message); }
    finally { button.disabled = false; button.textContent = 'Import historical records'; }
  }

  async function loadSharedData() {
    const [servicesResult, peopleResult] = await Promise.all([
      db.from('services').select('*').order('service_date', { ascending: true }),
      db.from('people').select('*').order('full_name', { ascending: true })
    ]);
    if (servicesResult.error) throw servicesResult.error;
    if (peopleResult.error) throw peopleResult.error;
    services = servicesResult.data.map(serviceFromDb);
    people = peopleResult.data.map(personFromDb);
    renderSharedViews();
    applyPermissions();
  }

  async function loadProfile() {
    const { data, error } = await db.from('profiles').select('*').eq('id', sessionUser.id).single();
    if (error) throw error;
    userProfile = data;
    document.querySelector('#profileName').textContent = data.full_name || data.email || 'Team member';
    document.querySelector('#profileRole').textContent = `${data.role[0].toUpperCase()}${data.role.slice(1)} access`;
    document.querySelector('#profileAvatar').textContent = initials(data.full_name || data.email || 'DL');
  }

  function applyPermissions() {
    const role = userProfile?.role || 'viewer';
    document.body.dataset.role = role;
    document.querySelectorAll('.admin-only').forEach(el => el.hidden = role !== 'admin');
    if (role === 'admin') renderTeam();
  }

  async function renderTeam() {
    if (userProfile?.role !== 'admin') return;
    const { data, error } = await db.from('profiles').select('*').order('created_at');
    if (error) { showToast(error.message); return; }
    document.querySelector('#teamRows').innerHTML = data.map(member => `<tr>
      <td><div class="person-cell"><span class="avatar">${initials(member.full_name || member.email || 'TM')}</span><span><strong>${member.full_name || 'Team member'}</strong><small>${member.id === sessionUser.id ? 'Your account' : 'Authorized account'}</small></span></div></td>
      <td>${member.email || '—'}</td>
      <td><select class="role-select" data-profile-id="${member.id}" ${member.id === sessionUser.id ? 'disabled' : ''}><option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Administrator</option><option value="reporter" ${member.role === 'reporter' ? 'selected' : ''}>Reporter</option><option value="viewer" ${member.role === 'viewer' ? 'selected' : ''}>Viewer</option></select></td>
      <td>${new Date(member.created_at).toLocaleDateString('en-CA')}</td>
    </tr>`).join('');
  }

  async function openSession(user) {
    sessionUser = user;
    authError.textContent = '';
    try {
      await loadProfile();
      await loadSharedData();
      authScreen.classList.add('authenticated');
    } catch (error) {
      authError.textContent = error.message.includes('profiles')
        ? 'Database setup is incomplete. Run supabase-schema.sql in the Supabase SQL Editor.'
        : error.message;
      authScreen.classList.remove('authenticated');
    }
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    authError.textContent = '';
    const button = loginForm.querySelector('button[type=submit]');
    button.disabled = true;
    button.textContent = 'Signing in…';
    const values = Object.fromEntries(new FormData(loginForm));
    const { data, error } = await db.auth.signInWithPassword({ email: values.email, password: values.password });
    button.disabled = false;
    button.textContent = 'Sign in securely';
    if (error) { authError.textContent = error.message; return; }
    await openSession(data.user);
  });

  document.querySelector('#logoutButton').addEventListener('click', async () => {
    await db.auth.signOut();
    sessionUser = null; userProfile = null; services = []; people = [];
    authScreen.classList.remove('authenticated');
    loginForm.reset();
  });

  document.querySelector('#attendanceForm').onsubmit = async event => {
    event.preventDefault();
    if (!['admin', 'reporter'].includes(userProfile?.role)) return;
    const form = event.currentTarget;
    const item = prepareServiceFromForm(form);
    try { await saveRegisterPeople(item.attendees, item.date); }
    catch (error) { showToast(error.message); return; }
    const existingId = item.id;
    delete item.id;
    const request = existingId
      ? db.from('services').update(serviceToDb(item)).eq('id', existingId).select().single()
      : db.from('services').insert(serviceToDb(item)).select().single();
    const { data, error } = await request;
    if (error) { showToast(error.message); return; }
    const saved = serviceFromDb(data);
    const index = services.findIndex(service => String(service.id) === String(saved.id));
    if (index > -1) services[index] = saved; else services.push(saved);
    await loadSharedData();
    resetAttendanceForm();
    document.querySelector('#attendanceModal').classList.remove('open');
    showToast(existingId ? 'Attendance updated in the shared database' : 'Attendance saved to the shared database');
  };

  document.querySelector('#personForm').onsubmit = async event => {
    event.preventDefault();
    if (!['admin', 'reporter'].includes(userProfile?.role)) return;
    const form = event.currentTarget;
    const item = Object.fromEntries(new FormData(form));
    const payload = {
      full_name: `${item.firstName} ${item.lastName}`.trim(), person_type: item.type,
      group_name: item.group, phone: item.phone || '', email: item.email || '',
      last_seen: new Date().toISOString().slice(0, 10),
      connection_status: item.type === 'Visitor' ? 'Follow-up' : 'Connected', notes: item.notes || ''
    };
    const { data, error } = await db.from('people').insert(payload).select().single();
    if (error) { showToast(error.message); return; }
    people.push(personFromDb(data));
    renderSharedViews(); applyPermissions(); form.reset();
    document.querySelector('#personModal').classList.remove('open');
    showToast(`${payload.full_name} saved securely`);
  };

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-complete]');
    if (!button || !['admin', 'reporter'].includes(userProfile?.role)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const person = people.find(item => item.id === button.dataset.complete);
    if (!person) return;
    const { error } = await db.from('people').update({ connection_status: 'Connected' }).eq('id', person.id);
    if (error) { showToast(error.message); return; }
    person.status = 'Connected'; renderSharedViews(); applyPermissions();
    showToast(`Follow-up completed for ${person.name}`);
  }, true);

  document.querySelector('#teamRows').addEventListener('change', async event => {
    const select = event.target.closest('.role-select');
    if (!select || userProfile?.role !== 'admin') return;
    const { error } = await db.from('profiles').update({ role: select.value }).eq('id', select.dataset.profileId);
    if (error) { showToast(error.message); await renderTeam(); return; }
    showToast('Team role updated');
  });

  document.querySelector('#importHistoryButton').addEventListener('click', async () => {
    if (userProfile?.role !== 'admin') return;
    const button = document.querySelector('#importHistoryButton');
    button.disabled = true; button.textContent = 'Importing…';
    try {
      const history = (window.OW_HISTORY || []).map(serviceToDb);
      const addedServices = await syncServices(history);
      const roster = (window.OW_PEOPLE_HISTORY || []).map(personToDb);
      const addedPeople = await syncRoster(roster);
      await loadSharedData();
      showToast(`${addedServices} services and ${addedPeople} people added`);
    } catch (error) { showToast(error.message); }
    finally { button.disabled = false; button.textContent = 'Import historical records'; }
  });

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-import-history]');
    if (!button) return;
    event.preventDefault();
    await importHistoricalRecords(button);
  });

  db.auth.getSession().then(({ data }) => {
    if (data.session?.user) openSession(data.session.user);
  });
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') authScreen.classList.remove('authenticated');
    if (event === 'SIGNED_IN' && session?.user && session.user.id !== sessionUser?.id) openSession(session.user);
  });
})();
