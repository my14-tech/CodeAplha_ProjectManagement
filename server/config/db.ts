import mongoose from 'mongoose'
import dotenv from 'dotenv'

dotenv.config()

const workspaceSchema = new mongoose.Schema({
  _id: { type: String, default: 'main' },
  users: { type: [mongoose.Schema.Types.Mixed], default: [] },
  projects: { type: [mongoose.Schema.Types.Mixed], default: [] },
  tasks: { type: [mongoose.Schema.Types.Mixed], default: [] },
  comments: { type: [mongoose.Schema.Types.Mixed], default: [] },
  notifications: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { versionKey: false, collection: 'workspace' })

export const WorkspaceStore = mongoose.models.WorkspaceStore || mongoose.model('WorkspaceStore', workspaceSchema)

const connectDB = async () => {
  const uri = process.env.MONGO_URI
  if (!uri) throw new Error('MONGO_URI is missing. Add it to the project root .env file.')

  await mongoose.connect(uri)
  console.log('MongoDB connected successfully')
}

export default connectDB