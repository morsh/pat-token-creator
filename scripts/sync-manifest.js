/* -----------------------------------------------------------------------

















console.log(`manifest.json version → ${newVersion}`);fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');manifest.version = newVersion;const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));const newVersion = process.env.npm_package_version;const manifestPath = path.join(__dirname, '..', 'manifest.json');const path = require('path');const fs = require('fs');// npm has already updated package.json; the new version is in process.env.npm_package_version.// Called by the npm `version` lifecycle hook.'use strict'; * <copyright company="Microsoft Corporation">
 *   Copyright (c) Microsoft Corporation.  All rights reserved.
 * </copyright>
 * ----------------------------------------------------------------------- */

#!/usr/bin/env node