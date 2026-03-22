#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const distDir = path.join(root, 'dist');
const zipName = `ado-pat-token-creator-v${pkg.version}.zip`;
const zipPath = path.join(distDir, zipName);

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);

// Remove stale zip for this version if it exists
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const files = ['manifest.json', 'popup.html', 'popup.css', 'popup.js', 'content.js', 'icons'];
execSync(`zip -r "${zipPath}" ${files.join(' ')}`, { cwd: root, stdio: 'inherit' });

console.log(`\nBundled → dist/${zipName}`);
