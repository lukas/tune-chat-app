const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Path to Electron's Info.plist
const plistPath = path.join(__dirname, 'node_modules/electron/dist/Electron.app/Contents/Info.plist');

// Check if file exists
if (!fs.existsSync(plistPath)) {
    console.error('Electron Info.plist not found. Make sure Electron is installed.');
    process.exit(1);
}

// Read the plist file
let plistContent = fs.readFileSync(plistPath, 'utf8');

// Replace the app name values
plistContent = plistContent.replace(
    /<key>CFBundleDisplayName<\/key>\s*<string>Electron<\/string>/,
    '<key>CFBundleDisplayName</key>\n\t<string>Tune Chat</string>'
);

plistContent = plistContent.replace(
    /<key>CFBundleName<\/key>\s*<string>Electron<\/string>/,
    '<key>CFBundleName</key>\n\t<string>Tune Chat</string>'
);

// Write the updated content back
fs.writeFileSync(plistPath, plistContent);

console.log('✅ Successfully updated Electron app name to "Tune Chat" for development!');

// Try to copy our custom icon if it exists
const customIconPath = path.join(__dirname, 'assets/icon.png');
const electronIconPath = path.join(__dirname, 'node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns');

if (fs.existsSync(customIconPath)) {
    console.log('🎨 Found custom icon, attempting to replace Electron icon...');
    
    // Note: PNG to ICNS conversion would require additional tools
    // For now, we'll just note that the icon needs to be in ICNS format
    console.log('   ⚠️  Note: Icon replacement requires ICNS format. Use iconutil or similar to convert PNG to ICNS.');
}

// Clear icon cache
console.log('🧹 Clearing macOS icon cache...');
try {
    execSync('sudo rm -rf /Library/Caches/com.apple.iconservices.store 2>/dev/null || true', { stdio: 'inherit' });
    execSync('killall Dock', { stdio: 'inherit' });
    console.log('✅ Icon cache cleared!');
} catch (e) {
    console.log('   ⚠️  Could not clear icon cache automatically. You may need to run manually with sudo.');
}

console.log('');
console.log('⚠️  Note: This is a temporary fix for development only.');
console.log('   The change will be overwritten if you reinstall node_modules.');
console.log('');
console.log('🚀 Now restart your app with: npm run dev');