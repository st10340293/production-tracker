// ============================================================
// Data access layer. Every function returns { data, error }.
// Nothing throws silently — callers always get an error object
// with a .message safe to show the user.
// ============================================================
const DataAPI = (() => {

  function wrapErr(err, fallback) {
    if (!err) return null;
    return { message: err.message || fallback || 'Something went wrong.', raw: err };
  }

  // ---------------- Auth ----------------

  async function signUp(email, password, fullName) {
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name: fullName } }
    });
    if (error) return { data: null, error: wrapErr(error, 'Could not create account.') };

    // profile row (id = auth user id). Ignore duplicate-key races.
    if (data.user) {
      await sb.from('profiles').upsert({
        id: data.user.id, email, full_name: fullName
      }, { onConflict: 'id' });
    }
    return { data, error: null };
  }

  async function signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { data: null, error: { message: 'Incorrect email or password.', raw: error } };
    return { data, error: null };
  }

  async function signOut() {
    const { error } = await sb.auth.signOut();
    return { data: null, error: wrapErr(error, 'Could not sign out.') };
  }

  async function getSession() {
    const { data, error } = await sb.auth.getSession();
    if (error) return { data: null, error: wrapErr(error) };
    return { data: data.session, error: null };
  }

  // ---------------- Profile ----------------

  async function getMyProfile() {
    const { data: userData } = await sb.auth.getUser();
    if (!userData?.user) return { data: null, error: { message: 'Not signed in.' } };
    const { data, error } = await sb.from('profiles').select('*').eq('id', userData.user.id).single();
    return { data, error: wrapErr(error, 'Could not load profile.') };
  }

  async function updateProfile(fields) {
    const { data: userData } = await sb.auth.getUser();
    if (!userData?.user) return { data: null, error: { message: 'Not signed in.' } };
    const { data, error } = await sb.from('profiles').update(fields).eq('id', userData.user.id).select().single();
    return { data, error: wrapErr(error, 'Could not save profile.') };
  }

  async function uploadAvatar(file) {
    const { data: userData } = await sb.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return { data: null, error: { message: 'Not signed in.' } };

    const ext = file.name.split('.').pop();
    const path = `${uid}/avatar_${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from('avatars').upload(path, file);
    if (upErr) return { data: null, error: wrapErr(upErr, 'Could not upload picture.') };

    const { data: urlData } = sb.storage.from('avatars').getPublicUrl(path);
    const { data, error } = await sb.from('profiles')
      .update({ avatar_url: urlData.publicUrl }).eq('id', uid).select().single();
    if (error) return { data: null, error: wrapErr(error, 'Picture uploaded, but could not be saved.') };
    return { data, error: null };
  }

  async function changePassword(currentPassword, newPassword) {
    const { data: userData } = await sb.auth.getUser();
    const email = userData?.user?.email;
    if (!email) return { data: null, error: { message: 'Not signed in.' } };

    // re-authenticate with the current password before allowing the change
    const { error: reauthErr } = await sb.auth.signInWithPassword({ email, password: currentPassword });
    if (reauthErr) return { data: null, error: { message: 'Current password is incorrect.' } };

    const { error } = await sb.auth.updateUser({ password: newPassword });
    return { data: null, error: wrapErr(error, 'Could not update password.') };
  }

  async function changeEmail(newEmail) {
    const { error } = await sb.auth.updateUser({ email: newEmail });
    return { data: null, error: wrapErr(error, 'Could not update email.') };
  }

  // ---------------- Projects ----------------

  async function listProjects() {
    const { data, error } = await sb
      .from('projects')
      .select(`
        id, title, description, item_singular, item_plural, owner_id, created_at, updated_at,
        stages ( id, stage_name, stage_order ),
        items ( id )
      `)
      .order('created_at', { ascending: false });
    if (error) return { data: null, error: wrapErr(error, 'Could not load projects.') };
    return { data, error: null };
  }

  async function createProject({ title, itemSingular, itemPlural, stages }) {
    const { data: userData } = await sb.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return { data: null, error: { message: 'You are not signed in.' } };

    const { data: project, error: pErr } = await sb
      .from('projects')
      .insert({ title, item_singular: itemSingular, item_plural: itemPlural, owner_id: uid })
      .select().single();
    if (pErr) return { data: null, error: wrapErr(pErr, 'Could not create project.') };

    // owner is implicitly a member with role owner
    await sb.from('project_members').insert({ project_id: project.id, user_id: uid, role: 'owner' });

    if (stages && stages.length) {
      const rows = stages.map((s, i) => ({ project_id: project.id, stage_name: s, stage_order: i }));
      const { error: sErr } = await sb.from('stages').insert(rows);
      if (sErr) return { data: null, error: wrapErr(sErr, 'Project created, but stages failed to save.') };
    }
    return { data: project, error: null };
  }

  async function getProjectFull(projectId) {
    const [proj, stages, items, progress, members] = await Promise.all([
      sb.from('projects').select('*').eq('id', projectId).single(),
      sb.from('stages').select('*').eq('project_id', projectId).order('stage_order'),
      sb.from('items').select('*').eq('project_id', projectId).order('sort_order', { ascending: true }),
      sb.from('item_progress').select('*, items!inner(project_id)').eq('items.project_id', projectId),
      sb.from('project_members').select('*, profiles(email, full_name)').eq('project_id', projectId)
    ]);
    if (proj.error) return { data: null, error: wrapErr(proj.error, 'Could not load project.') };
    if (stages.error) return { data: null, error: wrapErr(stages.error) };
    if (items.error) return { data: null, error: wrapErr(items.error) };
    if (progress.error) return { data: null, error: wrapErr(progress.error) };
    if (members.error) return { data: null, error: wrapErr(members.error) };

    return {
      data: {
        project: proj.data,
        stages: stages.data,
        items: items.data,
        progress: progress.data,
        members: members.data
      },
      error: null
    };
  }

  async function updateProjectMeta(projectId, fields) {
    const { data, error } = await sb.from('projects').update(fields).eq('id', projectId).select().single();
    return { data, error: wrapErr(error, 'Could not save project changes.') };
  }

  async function deleteProject(projectId) {
    const { error } = await sb.from('projects').delete().eq('id', projectId);
    return { data: null, error: wrapErr(error, 'Could not delete project.') };
  }

  // ---------------- Stages ----------------

  async function replaceStages(projectId, stageList) {
    // stageList: [{id?, name}] in desired order. Existing ids are renamed/reordered in place
    // (preserves progress). Ids not present anymore are deleted (drops their checkmarks).
    const existing = await sb.from('stages').select('id').eq('project_id', projectId);
    if (existing.error) return { data: null, error: wrapErr(existing.error) };
    const keepIds = new Set(stageList.filter(s => s.id).map(s => s.id));
    const toDelete = existing.data.filter(s => !keepIds.has(s.id)).map(s => s.id);

    if (toDelete.length) {
      const del = await sb.from('stages').delete().in('id', toDelete);
      if (del.error) return { data: null, error: wrapErr(del.error, 'Could not remove stage.') };
    }

    for (let i = 0; i < stageList.length; i++) {
      const s = stageList[i];
      if (s.id) {
        const up = await sb.from('stages').update({ stage_name: s.name, stage_order: i }).eq('id', s.id);
        if (up.error) return { data: null, error: wrapErr(up.error, 'Could not update stage.') };
      } else {
        const ins = await sb.from('stages').insert({ project_id: projectId, stage_name: s.name, stage_order: i });
        if (ins.error) return { data: null, error: wrapErr(ins.error, 'Could not add stage.') };
      }
    }
    return { data: true, error: null };
  }

  // ---------------- Items ----------------

  async function createItem(projectId, fields) {
    const { data, error } = await sb.from('items')
      .insert({ project_id: projectId, ...fields })
      .select().single();
    return { data, error: wrapErr(error, 'Could not add item.') };
  }

  async function bulkCreateItems(projectId, rows) {
    const payload = rows.map(r => ({ project_id: projectId, ...r }));
    const { data, error } = await sb.from('items').insert(payload).select();
    return { data, error: wrapErr(error, 'Could not import items.') };
  }

  async function updateItem(itemId, fields) {
    const { data, error } = await sb.from('items').update(fields).eq('id', itemId).select().single();
    return { data, error: wrapErr(error, 'Could not save item.') };
  }

  async function deleteItem(itemId) {
    const { error } = await sb.from('items').delete().eq('id', itemId);
    return { data: null, error: wrapErr(error, 'Could not delete item.') };
  }

  async function bulkDeleteItems(itemIds) {
    const { error } = await sb.from('items').delete().in('id', itemIds);
    return { data: null, error: wrapErr(error, 'Could not delete selected items.') };
  }

  async function bulkUpdateItems(updates) {
    // updates: [{id, fields}] — run sequentially, collect first error
    for (const u of updates) {
      const { error } = await sb.from('items').update(u.fields).eq('id', u.id);
      if (error) return { data: null, error: wrapErr(error, 'Could not save some items.') };
    }
    return { data: true, error: null };
  }

  // ---------------- Progress ----------------

  async function setProgress(itemId, stageId, completed) {
    const { error } = await sb.from('item_progress').upsert({
      item_id: itemId, stage_id: stageId, completed,
      completed_at: completed ? new Date().toISOString() : null
    }, { onConflict: 'item_id,stage_id' });
    return { data: null, error: wrapErr(error, 'Could not save progress.') };
  }

  async function bulkSetProgress(itemIds, stageId, completed) {
    const rows = itemIds.map(id => ({
      item_id: id, stage_id: stageId, completed,
      completed_at: completed ? new Date().toISOString() : null
    }));
    const { error } = await sb.from('item_progress').upsert(rows, { onConflict: 'item_id,stage_id' });
    return { data: null, error: wrapErr(error, 'Could not save progress for selection.') };
  }

  // ---------------- Members ----------------

  async function inviteMember(projectId, email, role) {
    const cleanEmail = email.trim().toLowerCase();
    const { data: prof, error: pErr } = await sb.from('profiles').select('id').ilike('email', cleanEmail).maybeSingle();
    if (pErr) return { data: null, error: wrapErr(pErr, 'Could not look up that email.') };

    if (prof) {
      const { data, error } = await sb.from('project_members')
        .insert({ project_id: projectId, user_id: prof.id, role })
        .select().single();
      if (error) {
        if (error.code === '23505') return { data: null, error: { message: 'That person is already a member.' } };
        return { data: null, error: wrapErr(error, 'Could not add member.') };
      }
      return { data: { ...data, pending: false }, error: null };
    }

    // no account yet — queue an invite that auto-attaches the moment they sign up
    const { data: userData } = await sb.auth.getUser();
    const { data, error } = await sb.from('pending_invites')
      .insert({ project_id: projectId, email: cleanEmail, role, invited_by: userData?.user?.id })
      .select().single();
    if (error) {
      if (error.code === '23505') return { data: null, error: { message: 'That email already has a pending invite.' } };
      return { data: null, error: wrapErr(error, 'Could not send invite.') };
    }
    return { data: { ...data, pending: true }, error: null };
  }

  async function removeMember(memberId) {
    const { error } = await sb.from('project_members').delete().eq('id', memberId);
    return { data: null, error: wrapErr(error, 'Could not remove member.') };
  }

  async function listPendingInvites(projectId) {
    const { data, error } = await sb.from('pending_invites').select('*').eq('project_id', projectId).order('created_at');
    return { data, error: wrapErr(error, 'Could not load pending invites.') };
  }

  async function cancelInvite(inviteId) {
    const { error } = await sb.from('pending_invites').delete().eq('id', inviteId);
    return { data: null, error: wrapErr(error, 'Could not cancel invite.') };
  }

  async function sendInviteEmail(projectId, inviteeEmail, role) {
    const { data, error } = await sb.functions.invoke('send-invite', {
      body: { projectId, inviteeEmail, role }
    });
    if (error) return { data: null, error: wrapErr(error, 'Invite saved, but the email failed to send.') };
    if (data?.error) return { data: null, error: { message: data.error } };
    return { data, error: null };
  }

  // ---------------- Activity ----------------

  async function listActivity(projectId, limit = 100) {
    const { data, error } = await sb
      .from('activity')
      .select('*, profiles(email, full_name)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return { data, error: wrapErr(error, 'Could not load activity.') };
  }

  // ---------------- Attachments ----------------

  async function listAttachments(itemId) {
    const { data, error } = await sb
      .from('attachments')
      .select('*')
      .eq('item_id', itemId)
      .order('created_at', { ascending: false });
    return { data, error: wrapErr(error, 'Could not load attachments.') };
  }

  async function uploadFileAttachment(projectId, itemId, file) {
    const { data: userData } = await sb.auth.getUser();
    const uid = userData?.user?.id;
    const path = `${projectId}/${itemId}/${Date.now()}_${file.name}`;

    const { error: upErr } = await sb.storage.from('attachments').upload(path, file);
    if (upErr) return { data: null, error: wrapErr(upErr, 'Could not upload file.') };

    const { data, error } = await sb.from('attachments').insert({
      item_id: itemId, project_id: projectId, kind: 'file',
      file_path: path, label: file.name, mime_type: file.type, size_bytes: file.size,
      created_by: uid
    }).select().single();

    if (error) {
      await sb.storage.from('attachments').remove([path]); // don't leave an orphaned object
      return { data: null, error: wrapErr(error, 'File uploaded, but could not be linked to the item.') };
    }
    return { data, error: null };
  }

  async function addLinkAttachment(projectId, itemId, url, label) {
    const { data: userData } = await sb.auth.getUser();
    const { data, error } = await sb.from('attachments').insert({
      item_id: itemId, project_id: projectId, kind: 'link',
      url, label: label || url, created_by: userData?.user?.id
    }).select().single();
    return { data, error: wrapErr(error, 'Could not save link.') };
  }

  async function getSignedUrl(filePath) {
    const { data, error } = await sb.storage.from('attachments').createSignedUrl(filePath, 60 * 60);
    if (error) return { data: null, error: wrapErr(error, 'Could not open file.') };
    return { data: data.signedUrl, error: null };
  }

  async function deleteAttachment(attachment) {
    if (attachment.kind === 'file' && attachment.file_path) {
      await sb.storage.from('attachments').remove([attachment.file_path]);
    }
    const { error } = await sb.from('attachments').delete().eq('id', attachment.id);
    return { data: null, error: wrapErr(error, 'Could not delete attachment.') };
  }

  return {
    signUp, signIn, signOut, getSession,
    getMyProfile, updateProfile, uploadAvatar, changePassword, changeEmail,
    listProjects, createProject, getProjectFull, updateProjectMeta, deleteProject,
    replaceStages,
    createItem, bulkCreateItems, updateItem, deleteItem, bulkDeleteItems, bulkUpdateItems,
    setProgress, bulkSetProgress,
    inviteMember, removeMember, listPendingInvites, cancelInvite, sendInviteEmail,
    listActivity,
    listAttachments, uploadFileAttachment, addLinkAttachment, getSignedUrl, deleteAttachment
  };
})();