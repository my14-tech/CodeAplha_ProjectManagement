import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Server } from 'socket.io'
import connectDB, { WorkspaceStore } from './config/db'

type User = { id: string; name: string; email: string; passwordHash: string; color: string }
type Project = { id: string; name: string; description: string; color: string; memberIds: string[]; createdAt: string }
type Task = { id: string; projectId: string; title: string; description: string; status: string; priority: string; dueDate: string; assigneeId: string; reporterId: string; createdAt: string }
type Comment = { id: string; taskId: string; userId: string; text: string; createdAt: string }
type Notice = { id: string; userId: string; taskId: string; text: string; createdAt: string; read: boolean }
type Store = { users: User[]; projects: Project[]; tasks: Task[]; comments: Comment[]; notifications: Notice[] }
type AuthRequest = Request & { userId?: string }

const app = express()
const server = createServer(app)
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' } })
const port = Number(process.env.PORT || 3001)
const secret = process.env.JWT_SECRET || 'development-secret-change-before-deploy'
const legacyDataFile = path.resolve('server/data.json')
let store: Store

const now = () => new Date().toISOString()
const publicUser = ({ passwordHash: _passwordHash, ...user }: User) => user
const save = async () => {
  await WorkspaceStore.replaceOne({ _id: 'main' }, { _id: 'main', ...store }, { upsert: true })
}
const publish = (type: string, payload: unknown, projectId: string) => {
  const project = store.projects.find((item) => item.id === projectId)
  for (const memberId of project?.memberIds || []) io.to(`user:${memberId}`).emit('workspace:update', { type, payload })
}

async function initialize() {
  await connectDB()
  const persisted = await WorkspaceStore.findById('main').lean()
  if (persisted) {
    const { _id: _storeId, ...data } = persisted
    store = data as Store
    return
  }

  let legacyStore: Store | undefined
  try {
    legacyStore = JSON.parse(await readFile(legacyDataFile, 'utf8')) as Store
  } catch {
    legacyStore = undefined
  }

  if (legacyStore) {
    store = legacyStore
    await save()
    console.log('Imported existing workspace data into MongoDB')
    return
  }

  {
    const demoId = randomUUID()
    const teammateId = randomUUID()
    const projectId = randomUUID()
    const demoUser: User = { id: demoId, name: 'Alex Morgan', email: 'demo@atlas.app', passwordHash: await bcrypt.hash('demo1234', 10), color: '#ee765f' }
    const teammate: User = { id: teammateId, name: 'Jamie Chen', email: 'jamie@atlas.app', passwordHash: await bcrypt.hash('demo1234', 10), color: '#55a98c' }
    store = {
      users: [demoUser, teammate],
      projects: [{ id: projectId, name: 'Website refresh', description: 'A thoughtful new home for Atlas.', color: '#d9745f', memberIds: [demoId, teammateId], createdAt: now() }],
      tasks: [
        { id: randomUUID(), projectId, title: 'Map the current site', description: 'Capture the main journeys and where people get stuck.', status: 'Done', priority: 'Medium', dueDate: '', assigneeId: demoId, reporterId: teammateId, createdAt: now() },
        { id: randomUUID(), projectId, title: 'Explore visual direction', description: 'Pull together a few ideas for the new identity.', status: 'In progress', priority: 'High', dueDate: '', assigneeId: teammateId, reporterId: demoId, createdAt: now() },
        { id: randomUUID(), projectId, title: 'Draft the homepage story', description: 'Shape the message around what teams need most.', status: 'In progress', priority: 'Medium', dueDate: '', assigneeId: demoId, reporterId: demoId, createdAt: now() },
        { id: randomUUID(), projectId, title: 'Build component inventory', description: 'List the reusable patterns we will need.', status: 'To do', priority: 'Low', dueDate: '', assigneeId: teammateId, reporterId: demoId, createdAt: now() },
        { id: randomUUID(), projectId, title: 'Review mobile navigation', description: 'Check the menu and key pages at small widths.', status: 'To do', priority: 'High', dueDate: '', assigneeId: '', reporterId: teammateId, createdAt: now() },
      ],
      comments: [],
      notifications: [],
    }
    await save()
  }
}

app.use(cors())
app.use(express.json())

function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' })
  try {
    const decoded = jwt.verify(token, secret) as { userId: string }
    if (!store.users.some((user) => user.id === decoded.userId)) return res.status(401).json({ error: 'Account not found.' })
    req.userId = decoded.userId
    next()
  } catch {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
  }
}

const projectFor = (userId: string, projectId: string) => store.projects.find((project) => project.id === projectId && project.memberIds.includes(userId))
const taskFor = (userId: string, taskId: string) => {
  const task = store.tasks.find((item) => item.id === taskId)
  return task && projectFor(userId, task.projectId) ? task : undefined
}
const tokenFor = (user: User) => jwt.sign({ userId: user.id }, secret, { expiresIn: '7d' })
const createNotice = async (userId: string, taskId: string, text: string) => {
  const notice: Notice = { id: randomUUID(), userId, taskId, text, createdAt: now(), read: false }
  store.notifications.unshift(notice)
  await save()
  io.to(`user:${userId}`).emit('notification:new', notice)
}

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body as { name?: string; email?: string; password?: string }
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) return res.status(400).json({ error: 'Add your name, a valid email, and a password of at least 8 characters.' })
  if (store.users.some((user) => user.email.toLowerCase() === email.trim().toLowerCase())) return res.status(409).json({ error: 'An account with that email already exists.' })
  const user: User = { id: randomUUID(), name: name.trim(), email: email.trim().toLowerCase(), passwordHash: await bcrypt.hash(password, 10), color: '#55a98c' }
  store.users.push(user)
  await save()
  res.status(201).json({ token: tokenFor(user), user: publicUser(user) })
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string }
  const user = store.users.find((item) => item.email.toLowerCase() === email?.trim().toLowerCase())
  if (!user || !password || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'That email and password do not match.' })
  res.json({ token: tokenFor(user), user: publicUser(user) })
})

app.use('/api', authenticate)

app.get('/api/me', (req: AuthRequest, res) => res.json(publicUser(store.users.find((user) => user.id === req.userId)!)))
app.get('/api/users', (req: AuthRequest, res) => {
  const memberIds = new Set(store.projects.filter((project) => project.memberIds.includes(req.userId!)).flatMap((project) => project.memberIds))
  memberIds.add(req.userId!)
  res.json(store.users.filter((user) => memberIds.has(user.id)).map(publicUser))
})
app.get('/api/projects', (req: AuthRequest, res) => res.json(store.projects.filter((project) => project.memberIds.includes(req.userId!))))
app.post('/api/projects', async (req: AuthRequest, res) => {
  const { name, description = '', color = '#d9745f' } = req.body as Partial<Project>
  if (!name?.trim()) return res.status(400).json({ error: 'A project name is required.' })
  const project: Project = { id: randomUUID(), name: name.trim(), description, color, memberIds: [req.userId!], createdAt: now() }
  store.projects.unshift(project)
  await save()
  publish('project.created', project, project.id)
  res.status(201).json(project)
})
app.post('/api/projects/:id/members', async (req: AuthRequest, res) => {
  const project = projectFor(req.userId!, String(req.params.id))
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  const user = store.users.find((item) => item.email.toLowerCase() === String(req.body.email || '').trim().toLowerCase())
  if (!user) return res.status(404).json({ error: 'No account exists for that email yet.' })
  if (!project.memberIds.includes(user.id)) project.memberIds.push(user.id)
  await save()
  publish('project.member-added', { projectId: project.id, userId: user.id }, project.id)
  res.json({ project, user: publicUser(user) })
})
app.get('/api/tasks', (req: AuthRequest, res) => {
  const projectId = String(req.query.projectId || '')
  if (!projectFor(req.userId!, projectId)) return res.status(404).json({ error: 'Project not found.' })
  res.json(store.tasks.filter((task) => task.projectId === projectId).map((task) => ({
    ...task,
    commentCount: store.comments.filter((comment) => comment.taskId === task.id).length,
  })))
})
app.post('/api/tasks', async (req: AuthRequest, res) => {
  const { projectId, title, description = '', status = 'To do', priority = 'Medium', dueDate = '', assigneeId = '' } = req.body as Partial<Task>
  if (!projectId || !projectFor(req.userId!, projectId)) return res.status(404).json({ error: 'Project not found.' })
  if (!title?.trim()) return res.status(400).json({ error: 'A task title is required.' })
  if (!['To do', 'In progress', 'Done'].includes(status)) return res.status(400).json({ error: 'Choose a valid task status.' })
  if (!['Low', 'Medium', 'High'].includes(priority)) return res.status(400).json({ error: 'Choose a valid task priority.' })
  if (assigneeId && !projectFor(assigneeId, projectId)) return res.status(400).json({ error: 'The assignee must belong to this project.' })
  const task: Task = { id: randomUUID(), projectId, title: title.trim(), description, status, priority, dueDate, assigneeId, reporterId: req.userId!, createdAt: now() }
  store.tasks.unshift(task)
  await save()
  publish('task.created', task, task.projectId)
  if (assigneeId && assigneeId !== req.userId) await createNotice(assigneeId, task.id, `${store.users.find((user) => user.id === req.userId)?.name} assigned you a task`)
  res.status(201).json(task)
})
app.patch('/api/tasks/:id', async (req: AuthRequest, res) => {
  const task = taskFor(req.userId!, String(req.params.id))
  if (!task) return res.status(404).json({ error: 'Task not found.' })
  const statuses = ['To do', 'In progress', 'Done']
  const priorities = ['Low', 'Medium', 'High']
  if ('title' in req.body && !String(req.body.title).trim()) return res.status(400).json({ error: 'A task title is required.' })
  if ('status' in req.body && !statuses.includes(req.body.status)) return res.status(400).json({ error: 'Choose a valid task status.' })
  if ('priority' in req.body && !priorities.includes(req.body.priority)) return res.status(400).json({ error: 'Choose a valid task priority.' })
  const nextAssignee = 'assigneeId' in req.body ? String(req.body.assigneeId) : task.assigneeId
  if (nextAssignee && !projectFor(nextAssignee, task.projectId)) return res.status(400).json({ error: 'The assignee must belong to this project.' })
  const previousAssignee = task.assigneeId
  const allowed = ['title', 'description', 'status', 'priority', 'dueDate', 'assigneeId'] as const
  for (const key of allowed) if (key in req.body) Object.assign(task, { [key]: req.body[key] })
  await save()
  publish('task.updated', task, task.projectId)
  if (task.assigneeId && task.assigneeId !== previousAssignee && task.assigneeId !== req.userId) await createNotice(task.assigneeId, task.id, `${store.users.find((user) => user.id === req.userId)?.name} assigned you a task`)
  res.json(task)
})
app.delete('/api/tasks/:id', async (req: AuthRequest, res) => {
  const task = taskFor(req.userId!, String(req.params.id))
  if (!task) return res.status(404).json({ error: 'Task not found.' })
  store.tasks = store.tasks.filter((item) => item.id !== task.id)
  store.comments = store.comments.filter((comment) => comment.taskId !== task.id)
  await save()
  publish('task.deleted', { id: task.id, projectId: task.projectId }, task.projectId)
  res.status(204).end()
})
app.get('/api/tasks/:id/comments', (req: AuthRequest, res) => {
  if (!taskFor(req.userId!, String(req.params.id))) return res.status(404).json({ error: 'Task not found.' })
  res.json(store.comments.filter((comment) => comment.taskId === req.params.id).map((comment) => ({ ...comment, user: publicUser(store.users.find((user) => user.id === comment.userId)!) })))
})
app.post('/api/tasks/:id/comments', async (req: AuthRequest, res) => {
  const task = taskFor(req.userId!, String(req.params.id))
  const text = String(req.body.text || '').trim()
  if (!task) return res.status(404).json({ error: 'Task not found.' })
  if (!text) return res.status(400).json({ error: 'Write a comment first.' })
  const comment: Comment = { id: randomUUID(), taskId: task.id, userId: req.userId!, text, createdAt: now() }
  store.comments.push(comment)
  await save()
  publish('comment.created', { taskId: task.id }, task.projectId)
  const noticeTarget = task.assigneeId && task.assigneeId !== req.userId ? task.assigneeId : task.reporterId !== req.userId ? task.reporterId : ''
  if (noticeTarget) await createNotice(noticeTarget, task.id, `${store.users.find((user) => user.id === req.userId)?.name} commented on a task`)
  res.status(201).json({ ...comment, user: publicUser(store.users.find((user) => user.id === req.userId)!) })
})
app.get('/api/notifications', (req: AuthRequest, res) => res.json(store.notifications.filter((notice) => notice.userId === req.userId)))
app.patch('/api/notifications/:id', async (req: AuthRequest, res) => {
  const notice = store.notifications.find((item) => item.id === req.params.id && item.userId === req.userId)
  if (!notice) return res.status(404).json({ error: 'Notification not found.' })
  notice.read = true
  await save()
  res.json(notice)
})

app.use(express.static(path.resolve('dist')))
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    res.sendFile(path.resolve('dist/index.html'), (error) => { if (error) next() })
    return
  }
  next()
})

io.use((socket, next) => {
  try {
    const token = String(socket.handshake.auth.token || '')
    const decoded = jwt.verify(token, secret) as { userId: string }
    socket.data.userId = decoded.userId
    next()
  } catch {
    next(new Error('Unauthorized'))
  }
})
io.on('connection', (socket) => socket.join(`user:${socket.data.userId}`))

initialize().then(() => server.listen(port, () => console.log(`Atlas API listening on http://localhost:${port}`))).catch((error) => {
  console.error('Could not initialize the local database:', error)
  process.exitCode = 1
})
