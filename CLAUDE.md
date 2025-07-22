# Claude Development Guide

## Setup Instructions

Use node to create a local web app
Use nvm to create your own node version

## Development Commands

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Testing

Use Playwright for testing and screenshotting the UIs created:

- `npm test` - Run tests headlessly
- `npm run test:headed` - Run tests with browser UI visible
- `npm run test:ui` - Run tests with Playwright's interactive UI