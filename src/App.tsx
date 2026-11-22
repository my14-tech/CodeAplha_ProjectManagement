import { type DragEvent, type FormEvent, useEffect, useMemo, useState } from 'react'
import { io } from 'socket.io-client'
import {
  Activity, ArrowDown, ArrowUp, Bell, CalendarDays, Check, ChevronDown, Circle,
  CircleCheck, CircleDot, LayoutGrid, LogOut, MessageCircle, MoreHorizontal,
  Plus, Search, Send, Sparkles, Users, X,
} from 'lucide-react'
import './App.css'

type User = { id: string; name: string; email: string; color: string }
type Project = { id: string; name: string; description: string; color: string; memberIds: string[]; createdAt: string }
type Task = { id: string; projectId: string; title: string; description: string; status: string; priority: string; dueDate: string; assigneeId: string; reporterId: string; createdAt: string; commentCount?: number }
type Comment = { id: string; taskId: string; userId: string; text: string; createdAt: string; user: User }
type Notice = { id: string; taskId: string; text: string; createdAt: string; read: boolean }
type TaskFields = Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'dueDate' | 'assigneeId'>

const columns = [
  { title: 'To do', icon: Circle, tone: 'todo' },
  { title: 'In progress', icon: CircleDot, tone: 'progress' },
  { title: 'Done', icon: CircleCheck, tone: 'done' },
]

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  const token = localStorage.getItem('atlas-token')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...options, headers })
  if (response.status === 204) return undefined as T
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Something went wrong.')
  return result as T
}

const initials = (name = '') => name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
const shortDate = (date: string) => date ? new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
const ago = (date: string) => {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 3600000))
  return hours < 1 ? 'Just now' : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

function Avatar({ user, size = 'normal' }: { user?: User; size?: 'normal' | 'small' }) {
  return <span className={`avatar ${size}`} style={{ backgroundColor: user?.color || '#bbc6bf' }} title={user?.name || 'Unassigned'}>{user ? initials(user.name) : <Users size={13} />}</span>
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(() => Boolean(localStorage.getItem('atlas-token')))
  const [projects, setProjects] = useState<Project[]>([])
  const [members, setMembers] = useState<User[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [projectId, setProjectId] = useState('')
  const [search, setSearch] = useState('')
  const [myTasksOnly, setMyTasksOnly] = useState(false)
  const [modal, setModal] = useState<'task' | 'project' | 'invite' | null>(null)
  const [taskDraft, setTaskDraft] = useState<Task | null>(null)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const project = projects.find((item) => item.id === projectId)
  const unreadCount = notices.filter((notice) => !notice.read).length

  useEffect(() => {
    const token = localStorage.getItem('atlas-token')
    if (!token) return
    api<User>('/api/me').then(setUser).catch(() => localStorage.removeItem('atlas-token')).finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    if (!user) return
    Promise.all([api<Project[]>('/api/projects'), api<User[]>('/api/users'), api<Notice[]>('/api/notifications')])
      .then(([nextProjects, nextMembers, nextNotices]) => {
        setProjects(nextProjects)
        setMembers(nextMembers)
        setNotices(nextNotices)
        setProjectId((current) => current || nextProjects[0]?.id || '')
      })
      .catch((cause: Error) => setError(cause.message))
  }, [user])

  useEffect(() => {
    if (!projectId) return
    api<Task[]>(`/api/tasks?projectId=${projectId}`).then(setTasks).catch((cause: Error) => setError(cause.message))
  }, [projectId])

  useEffect(() => {
    const token = localStorage.getItem('atlas-token')
    if (!user || !token) return
    const socket = io({ auth: { token } })
    socket.on('workspace:update', () => {
      api<Project[]>('/api/projects').then(setProjects).catch(() => undefined)
      if (projectId) api<Task[]>(`/api/tasks?projectId=${projectId}`).then(setTasks).catch(() => undefined)
    })
    socket.on('notification:new', (notice: Notice) => setNotices((current) => [notice, ...current]))
    return () => { socket.disconnect() }
  }, [user, projectId])

  const visibleTasks = useMemo(() => tasks.filter((task) => `${task.title} ${task.description}`.toLowerCase().includes(search.toLowerCase()) && (!myTasksOnly || task.assigneeId === user?.id)), [tasks, search, myTasksOnly, user])

  async function authenticate(mode: 'login' | 'register', values: { name?: string; email: string; password: string }) {
    setBusy(true); setError('')
    try {
      const result = await api<{ token: string; user: User }>(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(values) })
      localStorage.setItem('atlas-token', result.token)
      setUser(result.user)
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }

  function signOut() {
    localStorage.removeItem('atlas-token')
    setUser(null); setProjects([]); setTasks([]); setNotices([])
  }

  async function saveTask(fields: TaskFields) {
    setBusy(true); setError('')
    try {
      const saved = taskDraft?.id
        ? await api<Task>(`/api/tasks/${taskDraft.id}`, { method: 'PATCH', body: JSON.stringify(fields) })
        : await api<Task>('/api/tasks', { method: 'POST', body: JSON.stringify({ ...fields, projectId }) })
      setTasks((current) => taskDraft?.id ? current.map((task) => task.id === saved.id ? saved : task) : [saved, ...current])
      setModal(null); setTaskDraft(null)
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }

  async function moveTask(taskId: string, status: string) {
    try {
      const updated = await api<Task>(`/api/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      setTasks((current) => current.map((task) => task.id === taskId ? updated : task))
    } catch (cause) { setError((cause as Error).message) }
  }

  async function createProject(values: { name: string; description: string; color: string }) {
    setBusy(true); setError('')
    try {
      const created = await api<Project>('/api/projects', { method: 'POST', body: JSON.stringify(values) })
      setProjects((current) => [created, ...current]); setTasks([]); setProjectId(created.id); setModal(null)
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }

  async function inviteMember(email: string) {
    if (!project) return
    setBusy(true); setError('')
    try {
      const result = await api<{ project: Project; user: User }>(`/api/projects/${project.id}/members`, { method: 'POST', body: JSON.stringify({ email }) })
      setProjects((current) => current.map((item) => item.id === result.project.id ? result.project : item))
      setMembers((current) => current.some((member) => member.id === result.user.id) ? current : [...current, result.user])
      setModal(null)
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }

  async function deleteTask(taskId: string) {
    try {
      await api(`/api/tasks/${taskId}`, { method: 'DELETE' })
      setTasks((current) => current.filter((task) => task.id !== taskId))
      setModal(null)
    } catch (cause) { setError((cause as Error).message) }
  }

  async function readNotice(notice: Notice) {
    if (notice.read) return
    try {
      const updated = await api<Notice>(`/api/notifications/${notice.id}`, { method: 'PATCH' })
      setNotices((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch { /* Notification state is refreshed on the next sign in. */ }
  }

  if (checking) return <div className="boot-screen"><span className="brand-mark">a</span><span>Opening your workspace</span></div>
  if (!user) return <AuthScreen onSubmit={authenticate} busy={busy} error={error} />

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Atlas home"><span className="brand-mark">a</span><span>atlas</span></a>
        <div className="top-divider" />
        <button className="workspace-switch"><span className="workspace-icon"><LayoutGrid size={15} /></span><span>Studio North</span><ChevronDown size={14} /></button>
        <div className="topbar-spacer" />
        <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks..." /><kbd>⌘ K</kbd></label>
        <div className="top-divider desktop-only" />
        <div className="notification-wrap">
          <button className={`icon-button ${noticeOpen ? 'active' : ''}`} title="Notifications" aria-label="Notifications" onClick={() => setNoticeOpen((open) => !open)}><Bell size={18} />{unreadCount > 0 && <span className="notification-dot" />}</button>
          {noticeOpen && <div className="notification-popover"><div className="popover-heading"><strong>Notifications</strong><span>{unreadCount} new</span></div>{notices.length ? notices.slice(0, 7).map((notice) => <button className={`notice-item ${notice.read ? '' : 'unread'}`} key={notice.id} onClick={() => readNotice(notice)}><span className="notice-icon"><Activity size={15} /></span><span><b>{notice.text}</b><small>{ago(notice.createdAt)}</small></span></button>) : <div className="empty-notices">You're all caught up.</div>}</div>}
        </div>
        <button className="user-menu" onClick={signOut} title="Sign out"><Avatar user={user} size="small" /><span className="signout-label">{user.name.split(' ')[0]}</span><LogOut size={14} /></button>
      </header>

      <div className="workspace-layout">
        <aside className="sidebar">
          <div className="side-label">WORKSPACE</div>
          <button className="side-link active"><LayoutGrid size={16} /> My projects <span className="side-count">{projects.length}</span></button>
          <button className={`side-link ${myTasksOnly ? 'active' : ''}`} onClick={() => setMyTasksOnly((current) => !current)}><Users size={16} /> My tasks</button>
          <div className="project-label"><span className="side-label">YOUR PROJECTS</span><button className="tiny-icon" title="Create project" onClick={() => setModal('project')}><Plus size={15} /></button></div>
          <nav className="project-nav" aria-label="Projects">
            {projects.map((item) => <button key={item.id} className={`project-link ${item.id === projectId ? 'selected' : ''}`} onClick={() => { setTasks([]); setProjectId(item.id) }}><span className="project-color" style={{ backgroundColor: item.color }} />{item.name}<span className="project-task-count">{tasks.filter((task) => task.projectId === item.id).length || ''}</span></button>)}
          </nav>
          <button className="new-project-link" onClick={() => setModal('project')}><Plus size={15} /> New project</button>
          <div className="sidebar-bottom">
            <div className="team-heading"><span className="side-label">TEAM MEMBERS</span><button className="tiny-icon" title="Invite teammate" onClick={() => setModal('invite')}><Plus size={15} /></button></div>
            <div className="team-list">{(project?.memberIds || []).map((id) => { const teammate = members.find((item) => item.id === id); return teammate ? <div className="team-person" key={id}><Avatar user={teammate} size="small" /><span>{teammate.name}</span><i className={teammate.id === user.id ? 'online' : ''} /></div> : null })}</div>
            <div className="sidebar-footer"><span className="live-dot" /> All changes saved</div>
          </div>
        </aside>

        <main className="main-content">
          {error && <div className="error-banner" role="alert"><span>{error}</span><button className="tiny-icon" onClick={() => setError('')} aria-label="Dismiss"><X size={15} /></button></div>}
          {project ? <>
            <div className="breadcrumb"><span>Projects</span><span className="breadcrumb-slash">/</span><span className="breadcrumb-current">{project.name}</span><span className="live-status"><i /> Live</span></div>
            <section className="project-heading">
              <div><div className="eyebrow">PROJECT BOARD <span>·</span> {new Date(project.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()}</div><h1>{project.name}</h1><p>{project.description || 'A shared space to move good work forward.'}</p></div>
              <div className="heading-actions"><div className="avatar-stack">{(project.memberIds || []).slice(0, 4).map((id) => <Avatar key={id} user={members.find((member) => member.id === id)} size="small" />)}<button className="stack-add" onClick={() => setModal('invite')} title="Invite teammate"><Plus size={14} /></button></div><button className="button button-secondary" onClick={() => setModal('invite')}><Users size={15} /> Invite</button><button className="button button-primary" onClick={() => { setTaskDraft(null); setModal('task') }}><Plus size={16} /> Add task</button></div>
            </section>
            <div className="board-toolbar"><div className="board-tabs"><button className="board-tab active"><LayoutGrid size={15} /> Board</button><button className="board-tab" onClick={() => setMyTasksOnly((current) => !current)}><Activity size={15} /> {myTasksOnly ? 'My tasks' : 'Team view'}</button></div><div className="toolbar-right"><span className="toolbar-members"><Users size={14} /> {project.memberIds.length} members</span><span className="toolbar-rule" /><button className="toolbar-filter" onClick={() => { setSearch(''); setMyTasksOnly(false) }}><span className="filter-indicator" /><span>Clear filters</span></button><button className="icon-button compact" title="More project options"><MoreHorizontal size={18} /></button></div></div>
            <section className="board" aria-label="Project board">
              {columns.map(({ title, icon: Icon, tone }) => {
                const items = visibleTasks.filter((task) => task.status === title)
                return <div className="board-column" key={title} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const taskId = event.dataTransfer.getData('text/plain'); if (taskId) void moveTask(taskId, title) }}>
                  <div className="column-heading"><div className={`column-icon ${tone}`}><Icon size={16} /></div><h2>{title}</h2><span className="column-count">{items.length}</span><button className="column-menu" title={`Add task to ${title}`} onClick={() => { setTaskDraft({ id: '', projectId, title: '', description: '', status: title, priority: 'Medium', dueDate: '', assigneeId: '', reporterId: user.id, createdAt: '' }); setModal('task') }}><Plus size={16} /></button></div>
                  <div className="task-list">{items.map((task, index) => <TaskCard key={task.id} task={task} members={members} index={index} onOpen={() => { setTaskDraft(task); setModal('task') }} onDrag={(event) => event.dataTransfer.setData('text/plain', task.id)} />)}
                    {items.length === 0 && <div className="column-empty">{search ? 'No matching tasks' : 'Nothing here yet'}</div>}
                    {title === 'To do' && <button className="add-task-inline" onClick={() => { setTaskDraft({ id: '', projectId, title: '', description: '', status: title, priority: 'Medium', dueDate: '', assigneeId: '', reporterId: user.id, createdAt: '' }); setModal('task') }}><Plus size={15} /> Add a task</button>}
                  </div>
                </div>
              })}
            </section>
            <div className="board-footnote"><span><Sparkles size={14} /> Great work happens together.</span><span>{tasks.length} tasks in this project</span></div>
          </> : <div className="no-project"><div className="no-project-icon"><LayoutGrid size={22} /></div><h1>Your workspace starts here</h1><p>Create a project and bring your team together around the work.</p><button className="button button-primary" onClick={() => setModal('project')}><Plus size={16} /> Create a project</button></div>}
        </main>
      </div>

      {modal === 'task' && <TaskDialog task={taskDraft} user={user} members={members.filter((member) => project?.memberIds.includes(member.id))} busy={busy} onClose={() => { setModal(null); setTaskDraft(null) }} onSave={saveTask} onDelete={taskDraft?.id ? () => deleteTask(taskDraft.id) : undefined} />}
      {modal === 'project' && <ProjectDialog busy={busy} onClose={() => setModal(null)} onSave={createProject} />}
      {modal === 'invite' && project && <InviteDialog project={project} members={members} busy={busy} onClose={() => setModal(null)} onInvite={inviteMember} />}
    </div>
  )
}

function TaskCard({ task, members, index, onOpen, onDrag }: { task: Task; members: User[]; index: number; onOpen: () => void; onDrag: (event: DragEvent) => void }) {
  const assignee = members.find((member) => member.id === task.assigneeId)
  return <article className="task-card" draggable onDragStart={onDrag} onClick={onOpen} style={{ animationDelay: `${Math.min(index * 45, 180)}ms` }}>
    <div className="task-card-top"><span className={`priority priority-${task.priority.toLowerCase()}`}>{task.priority === 'High' ? <ArrowUp size={12} /> : task.priority === 'Low' ? <ArrowDown size={12} /> : <span className="priority-dash" />}{task.priority}</span><button className="task-more" aria-label="Open task details" onClick={(event) => { event.stopPropagation(); onOpen() }}><MoreHorizontal size={17} /></button></div>
    <h3>{task.title}</h3>{task.description && <p className="task-description">{task.description}</p>}
    <div className="task-card-bottom"><div className="task-meta">{task.dueDate && <span className="due-date"><CalendarDays size={13} />{shortDate(task.dueDate)}</span>}<span className="comment-count"><MessageCircle size={13} /> <span>{task.commentCount || 0}</span></span></div><Avatar user={assignee} size="small" /></div>
  </article>
}

function AuthScreen({ onSubmit, busy, error }: { onSubmit: (mode: 'login' | 'register', values: { name?: string; email: string; password: string }) => void; busy: boolean; error: string }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(mode, { name, email, password }) }
  return <div className="auth-screen"><aside className="auth-aside"><a className="brand auth-brand" href="#home"><span className="brand-mark">a</span><span>atlas</span></a><div className="auth-art"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-card"><div className="art-card-head"><span className="art-square" /><span /><span /></div><div className="art-lines"><i /><i /><i /></div><div className="art-task"><span className="art-check"><Check size={12} /></span><span>Make room for good work</span></div><div className="art-task muted"><span className="art-check" /><span>Bring your team along</span></div><div className="art-avatars"><span>AM</span><span>JC</span><span>+2</span></div></div><div className="art-sticker"><Sparkles size={16} /><span>IN SYNC</span></div></div><div className="auth-aside-copy"><span className="eyebrow">WORK, IN GOOD COMPANY</span><h1>Make space<br />for momentum.</h1><p>Keep the big picture close and the next step clear.</p></div><div className="auth-aside-footer"><span>© 2026 Atlas Workspace</span><span>Built for teams that care about the details.</span></div></aside>
    <main className="auth-main"><div className="auth-form-wrap"><span className="auth-kicker">YOUR TEAM'S NEW HOME</span><h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2><p className="auth-intro">{mode === 'login' ? 'Sign in to pick up where your team left off.' : 'A little structure makes room for better work.'}</p>
      <div className="auth-switch"><button className={mode === 'login' ? 'selected' : ''} onClick={() => setMode('login')}>Sign in</button><button className={mode === 'register' ? 'selected' : ''} onClick={() => setMode('register')}>Create account</button></div>
      <form className="auth-form" onSubmit={submit}>{mode === 'register' && <label>Your name<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex Morgan" required /></label>}<label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required /></label><label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter your password'} minLength={mode === 'register' ? 8 : undefined} required /></label>{error && <div className="auth-error">{error}</div>}<button className="button button-primary auth-submit" disabled={busy}>{busy ? 'One moment...' : mode === 'login' ? 'Sign in to Atlas' : 'Create account'}<span>→</span></button></form>
      <div className="demo-login"><span className="demo-icon"><Sparkles size={15} /></span><span><b>Just looking around?</b><small>Explore with our demo workspace.</small></span><button onClick={() => onSubmit('login', { email: 'demo@atlas.app', password: 'demo1234' })} disabled={busy}>Try demo <ArrowUp size={13} /></button></div>
    </div><div className="auth-footer"><span>Thoughtful work, together.</span><span className="security-note"><span /> Your workspace is private</span></div></main></div>
}

function TaskDialog({ task, user, members, busy, onClose, onSave, onDelete }: { task: Task | null; user: User; members: User[]; busy: boolean; onClose: () => void; onSave: (fields: TaskFields) => void; onDelete?: () => void }) {
  const isEditing = Boolean(task?.id)
  const [fields, setFields] = useState<TaskFields>({ title: task?.title || '', description: task?.description || '', status: task?.status || 'To do', priority: task?.priority || 'Medium', dueDate: task?.dueDate || '', assigneeId: task?.assigneeId || '' })
  const [comments, setComments] = useState<Comment[]>([])
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState('')
  useEffect(() => { if (task?.id) api<Comment[]>(`/api/tasks/${task.id}/comments`).then(setComments).catch(() => undefined) }, [task?.id])
  const change = (key: keyof TaskFields, value: string) => setFields((current) => ({ ...current, [key]: value }))
  async function addComment() {
    if (!task?.id || !commentText.trim()) return
    try { const comment = await api<Comment>(`/api/tasks/${task.id}/comments`, { method: 'POST', body: JSON.stringify({ text: commentText }) }); setComments((current) => [...current, comment]); setCommentText(''); setCommentError('') } catch (cause) { setCommentError((cause as Error).message) }
  }
    return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="dialog task-dialog" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title"><div className="dialog-top"><span className="dialog-context"><span className="context-dot" /> {isEditing ? 'TASK DETAILS' : 'NEW TASK'}</span><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); onSave(fields) }}><div className="task-dialog-content"><div className="task-editor"><input id="task-dialog-title" className="task-title-input" value={fields.title} onChange={(event) => change('title', event.target.value)} placeholder="Task name" required autoFocus /><textarea className="task-description-input" value={fields.description} onChange={(event) => change('description', event.target.value)} placeholder="Add a little context for your team..." rows={3} /><div className="field-grid"><label>Status<select value={fields.status} onChange={(event) => change('status', event.target.value)}>{columns.map((column) => <option key={column.title}>{column.title}</option>)}</select></label><label>Priority<select value={fields.priority} onChange={(event) => change('priority', event.target.value)}><option>Low</option><option>Medium</option><option>High</option></select></label><label>Assignee<select value={fields.assigneeId} onChange={(event) => change('assigneeId', event.target.value)}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label>Due date<input type="date" value={fields.dueDate} onChange={(event) => change('dueDate', event.target.value)} /></label></div></div>
      {isEditing && <div className="comments-section"><div className="comments-heading"><h3>Conversation</h3><span>{comments.length}</span></div><div className="comment-list">{comments.length ? comments.map((comment) => <div className="comment" key={comment.id}><Avatar user={comment.user} size="small" /><div><div className="comment-byline"><b>{comment.user.name}</b><span>{ago(comment.createdAt)}</span></div><p>{comment.text}</p></div></div>) : <div className="comments-empty">No comments yet. Start the conversation.</div>}</div><div className="comment-compose">{commentError && <span className="comment-error">{commentError}</span>}<div className="comment-compose-row"><Avatar user={user} size="small" /><div className="comment-input-row"><input value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Write a comment..." aria-label="Write a comment" /><button type="button" className="send-button" onClick={() => void addComment()} aria-label="Send comment" disabled={!commentText.trim()}><Send size={15} /></button></div></div></div></div>}
      </div><footer className="dialog-actions">{onDelete && <button type="button" className="text-button danger-text" onClick={onDelete}>Delete task</button>}<span className="dialog-action-spacer" /><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Saving...' : isEditing ? 'Save changes' : 'Create task'}</button></footer></form></section></div>
}

function ProjectDialog({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (values: { name: string; description: string; color: string }) => void }) {
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [color, setColor] = useState('#d9745f')
  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="dialog compact-dialog" role="dialog" aria-modal="true"><div className="dialog-top"><span className="dialog-context"><span className="context-dot" /> START SOMETHING NEW</span><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); onSave({ name, description, color }) }}><div className="dialog-body"><h2>Create a project</h2><p>Give your team a clear place to make progress.</p><label>Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Website refresh" required /></label><label>What are you working on?<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A sentence to set the scene..." rows={3} /></label><div className="color-picker-label">Project color</div><div className="color-picker">{['#d9745f', '#4b9b81', '#6683c3', '#d2a344', '#8e75a6'].map((swatch) => <button type="button" key={swatch} className={color === swatch ? 'chosen' : ''} style={{ backgroundColor: swatch }} onClick={() => setColor(swatch)} aria-label={`Choose ${swatch}`} />)}</div></div><footer className="dialog-actions"><span className="dialog-action-spacer" /><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy || !name.trim()}>{busy ? 'Creating...' : 'Create project'}</button></footer></form></section></div>
}

function InviteDialog({ project, members, busy, onClose, onInvite }: { project: Project; members: User[]; busy: boolean; onClose: () => void; onInvite: (email: string) => void }) {
  const [email, setEmail] = useState('')
  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="dialog compact-dialog" role="dialog" aria-modal="true"><div className="dialog-top"><span className="dialog-context"><span className="context-dot" /> YOUR PEOPLE</span><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); onInvite(email) }}><div className="dialog-body"><h2>Bring someone in</h2><p>Invite a teammate to {project.name} using their Atlas account email.</p><label>Email address<input type="email" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@company.com" required /></label><div className="member-preview"><div className="member-preview-avatars">{project.memberIds.map((id) => <Avatar key={id} user={members.find((member) => member.id === id)} size="small" />)}</div><span>{project.memberIds.length} {project.memberIds.length === 1 ? 'person' : 'people'} can access this project</span></div></div><footer className="dialog-actions"><span className="dialog-action-spacer" /><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Inviting...' : 'Invite teammate'}</button></footer></form></section></div>
}

export default App
