# SplitEase

SplitEase is a shared-expense management frontend built using
HTML, CSS, and JavaScript.

## Features

- Dashboard with expense totals
- Create and delete groups
- Add and delete expenses
- Equal expense splitting
- Suggested settlements
- Responsive dark-themed interface
- Browser-based data persistence

## Folder Structure

- index.html — Main application interface
- css/style.css — UI styling and responsive layout
- js/app.js — Application logic and event handling
- js/api.js — Local data storage adapter

## Running the Project

1. Open the frontend folder in VS Code.
2. Install the Live Server extension if needed.
3. Right-click index.html.
4. Select Open with Live Server.

## Backend Integration

The current implementation uses browser localStorage
as a temporary data layer.

Replace the data adapter with backend API requests
once the backend endpoints are available.

Note: Local demo data is not shared between users
or devices.