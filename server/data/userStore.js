const fs = require('fs');
const path = require('path');

const dataFilePath = path.join(__dirname, 'users.json');

// Initialize users.json if it doesn't exist
if (!fs.existsSync(dataFilePath)) {
  fs.writeFileSync(dataFilePath, JSON.stringify([], null, 2), 'utf-8');
}

function readUsers() {
  try {
    const raw = fs.readFileSync(dataFilePath, 'utf-8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error('Error reading users file:', err);
    return [];
  }
}

function writeUsers(users) {
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify(users, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing users file:', err);
  }
}

function findUserByEmail(email) {
  const users = readUsers();
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

function findUserById(id) {
  const users = readUsers();
  return users.find((u) => u.id === id);
}

function createUser({ name, email, passwordHash }) {
  const users = readUsers();
  const newUser = {
    id: 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    passwordHash,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  writeUsers(users);
  return {
    id: newUser.id,
    name: newUser.name,
    email: newUser.email,
    createdAt: newUser.createdAt
  };
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUser
};
