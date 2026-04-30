# Setup Instructions

## Install Dependencies

Before running the application, you need to install the dependencies:

```bash
cd frontend
npm install
```

This will install all required packages including:
- React and React DOM
- Next.js
- Zustand (state management)
- TanStack Query (data fetching)
- And all other dependencies listed in package.json

## Run Development Server

After installing dependencies:

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## TypeScript Errors

If you see TypeScript errors in your IDE before running `npm install`, this is normal. The errors will disappear once:
1. Dependencies are installed (`npm install`)
2. Your IDE has indexed the node_modules folder

## Testing the Split-Pane Feature

Once the dev server is running, visit:
- `/tasks` - Task list view with split-pane
- `/board` - Board view with split-pane

Click on any task card to open the detail pane.

## Troubleshooting

### "Cannot find module 'zustand'" or similar errors
- Run `npm install` in the frontend directory
- Restart your IDE/editor
- Wait for TypeScript to finish indexing

### Split-pane not working
- Check browser console for errors
- Ensure you're on a supported route (`/tasks` or `/board`)
- Try clicking on a task card to trigger the pane
