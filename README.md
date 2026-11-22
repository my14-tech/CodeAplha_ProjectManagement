# Atlas Project Workspace

A full-stack team project board for managing projects, assigned work, task conversations, and notifications. Built with React, TypeScript, Express, Socket.IO, and MongoDB.

## Run locally

Create a `.env` file in the project root using `.env.example` as a template. Set `MONGO_URI` to your local MongoDB connection string or MongoDB Atlas URI. For Atlas, create a database user and allow your machine's IP in Network Access before starting the app.

```sh
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The development command starts both the frontend and API; the API listens on port 3001. The server requires MongoDB to be reachable and exits with an error if `MONGO_URI` is missing or invalid.

On first startup, existing records in `server/data.json` are imported into the MongoDB `workspace` collection. Once imported, MongoDB is the source of truth.

## Demo account

Use **Try demo** on the sign-in screen, or sign in with:

- Email: `demo@atlas.app`
- Password: `demo1234`

To try collaboration, register a second account, then invite that email from a project. Invited users need an account before they can be added.

## Features

- Email/password registration and sign-in with hashed passwords and signed JWT sessions
- Create projects, invite existing Atlas users, and browse project members
- Create, assign, edit, delete, prioritize, and drag tasks across board statuses
- Task due dates and comment threads
- Per-user notifications for task assignments and comments
- Socket.IO board and notification updates scoped to project members
- Persistent workspace records in MongoDB

## Build and run

```sh
npm run build
npm start
```

After building, the Express server serves the frontend and API on port 3001. Set `JWT_SECRET` to a strong private value before using this outside local development.
