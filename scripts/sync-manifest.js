#!/usr/bin/env node
'use strict';

// Called by the npm `version` lifecycle hook.
// npm has already updated package.json; the new version is in process.env.npm_package_version.

const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'manifest.json');
const newVersion = process.env.npm_package_version;

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.version = newVersion;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`manifest.json version → ${newVersion}`);
