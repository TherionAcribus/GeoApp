#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const alphabetsRoot = path.join(repoRoot, 'alphabets');
const errors = [];
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const SFNT_REQUIRED_TABLES = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name'];

function addError(alphabetId, message) {
    errors.push(`${alphabetId}: ${message}`);
}

function isCharacterList(value) {
    return value === 'all' || (Array.isArray(value) && value.every(item => typeof item === 'string'));
}

function getCharacterList(value, kind) {
    if (value === 'all') {
        if (kind === 'letters') {
            return Array.from({ length: 26 }, (_, index) => String.fromCharCode(97 + index));
        }
        return Array.from({ length: 10 }, (_, index) => String(index));
    }
    return Array.isArray(value) ? value : [];
}

function fileExists(...segments) {
    return fs.existsSync(path.join(...segments));
}

function getLetterImageCandidates(config, char) {
    const imageDir = config.imageDir || 'images';
    const format = config.imageFormat;
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    const lowercaseSuffix = config.lowercaseSuffix || 'lowercase';
    const uppercaseSuffix = config.uppercaseSuffix || 'uppercase';

    return [
        `${imageDir}/${char}.${format}`,
        `${imageDir}/${lower}.${format}`,
        `${imageDir}/${upper}.${format}`,
        `${imageDir}/${lower}_${lowercaseSuffix}.${format}`,
        `${imageDir}/${upper}_${lowercaseSuffix}.${format}`,
        `${imageDir}/${upper}_${uppercaseSuffix}.${format}`,
        `${imageDir}/${lower}_${uppercaseSuffix}.${format}`
    ];
}

function hasAnyImage(alphabetDir, candidates) {
    return candidates.some(candidate => fileExists(alphabetDir, candidate));
}

function readUInt16(buffer, offset) {
    return buffer.readUInt16BE(offset);
}

function readUInt32(buffer, offset) {
    return buffer.readUInt32BE(offset);
}

function readTag(buffer, offset) {
    return buffer.toString('ascii', offset, offset + 4);
}

function validateSfntFont(alphabetId, relativeFontPath, buffer) {
    if (buffer.length < 12) {
        addError(alphabetId, `font file is too small: ${relativeFontPath}`);
        return;
    }

    const signature = readTag(buffer, 0);
    const sfntVersion = readUInt32(buffer, 0);
    const isTrueType = sfntVersion === 0x00010000 || signature === 'true';
    const isOpenType = signature === 'OTTO';
    if (!isTrueType && !isOpenType) {
        addError(alphabetId, `font file has invalid SFNT signature: ${relativeFontPath}`);
        return;
    }

    const numTables = readUInt16(buffer, 4);
    const tableDirectoryEnd = 12 + numTables * 16;
    if (numTables <= 0 || tableDirectoryEnd > buffer.length) {
        addError(alphabetId, `font file has invalid table directory: ${relativeFontPath}`);
        return;
    }

    const tables = new Map();
    for (let index = 0; index < numTables; index += 1) {
        const offset = 12 + index * 16;
        const tag = readTag(buffer, offset);
        const tableOffset = readUInt32(buffer, offset + 8);
        const tableLength = readUInt32(buffer, offset + 12);
        if (tableOffset <= 0 || tableLength <= 0 || tableOffset + tableLength > buffer.length) {
            addError(alphabetId, `font table ${tag} points outside file: ${relativeFontPath}`);
            return;
        }
        tables.set(tag, { offset: tableOffset, length: tableLength });
    }

    for (const table of SFNT_REQUIRED_TABLES) {
        if (!tables.has(table)) {
            addError(alphabetId, `font file is missing required table "${table}": ${relativeFontPath}`);
        }
    }

    if (isTrueType && (!tables.has('glyf') || !tables.has('loca'))) {
        addError(alphabetId, `TrueType font must contain glyf and loca tables: ${relativeFontPath}`);
    }
    if (isOpenType && !tables.has('CFF ') && !tables.has('CFF2')) {
        addError(alphabetId, `OpenType font must contain CFF or CFF2 table: ${relativeFontPath}`);
    }
}

function validateWoffFont(alphabetId, relativeFontPath, buffer) {
    if (buffer.length < 44) {
        addError(alphabetId, `WOFF font file is too small: ${relativeFontPath}`);
        return;
    }
    const flavor = readUInt32(buffer, 4);
    const length = readUInt32(buffer, 8);
    const numTables = readUInt16(buffer, 12);
    if (length !== buffer.length) {
        addError(alphabetId, `WOFF declared length does not match file size: ${relativeFontPath}`);
    }
    if (numTables <= 0) {
        addError(alphabetId, `WOFF font has no table entries: ${relativeFontPath}`);
    }
    if (flavor !== 0x00010000 && flavor !== 0x4f54544f) {
        addError(alphabetId, `WOFF font has unsupported flavor: ${relativeFontPath}`);
    }
}

function validateWoff2Font(alphabetId, relativeFontPath, buffer) {
    if (buffer.length < 48) {
        addError(alphabetId, `WOFF2 font file is too small: ${relativeFontPath}`);
        return;
    }
    const flavor = readUInt32(buffer, 4);
    const length = readUInt32(buffer, 8);
    const numTables = readUInt16(buffer, 12);
    if (length !== buffer.length) {
        addError(alphabetId, `WOFF2 declared length does not match file size: ${relativeFontPath}`);
    }
    if (numTables <= 0) {
        addError(alphabetId, `WOFF2 font has no table entries: ${relativeFontPath}`);
    }
    if (flavor !== 0x00010000 && flavor !== 0x4f54544f) {
        addError(alphabetId, `WOFF2 font has unsupported flavor: ${relativeFontPath}`);
    }
}

function validateFontFile(alphabetId, alphabetDir, relativeFontPath) {
    const extension = path.extname(relativeFontPath).toLowerCase();
    if (!FONT_EXTENSIONS.has(extension)) {
        addError(alphabetId, `font file must use .ttf, .otf, .woff or .woff2: ${relativeFontPath}`);
        return;
    }

    const fontPath = path.join(alphabetDir, relativeFontPath);
    if (!fs.existsSync(fontPath)) {
        addError(alphabetId, `font file not found: ${relativeFontPath}`);
        return;
    }
    if (!fs.statSync(fontPath).isFile()) {
        addError(alphabetId, `font path is not a file: ${relativeFontPath}`);
        return;
    }

    const buffer = fs.readFileSync(fontPath);
    if (buffer.length < 4) {
        addError(alphabetId, `font file is empty or too small: ${relativeFontPath}`);
        return;
    }

    const signature = readTag(buffer, 0);
    if (extension === '.woff') {
        if (signature !== 'wOFF') {
            addError(alphabetId, `font extension .woff does not match file signature: ${relativeFontPath}`);
            return;
        }
        validateWoffFont(alphabetId, relativeFontPath, buffer);
        return;
    }
    if (extension === '.woff2') {
        if (signature !== 'wOF2') {
            addError(alphabetId, `font extension .woff2 does not match file signature: ${relativeFontPath}`);
            return;
        }
        validateWoff2Font(alphabetId, relativeFontPath, buffer);
        return;
    }

    validateSfntFont(alphabetId, relativeFontPath, buffer);
}

function validateImages(alphabetId, alphabetDir, config, characters) {
    if (!config.imageDir || typeof config.imageDir !== 'string') {
        addError(alphabetId, 'alphabetConfig.imageDir is required for image alphabets');
        return;
    }
    if (!config.imageFormat || typeof config.imageFormat !== 'string') {
        addError(alphabetId, 'alphabetConfig.imageFormat is required for image alphabets');
        return;
    }
    if (!fileExists(alphabetDir, config.imageDir)) {
        addError(alphabetId, `imageDir not found: ${config.imageDir}`);
        return;
    }

    for (const char of getCharacterList(characters.letters, 'letters')) {
        if (!hasAnyImage(alphabetDir, getLetterImageCandidates(config, char))) {
            addError(alphabetId, `missing image for letter "${char}"`);
        }
    }

    for (const char of getCharacterList(characters.numbers, 'numbers')) {
        const imagePath = `${config.imageDir}/${char}.${config.imageFormat}`;
        if (!fileExists(alphabetDir, imagePath)) {
            addError(alphabetId, `missing image for number "${char}": ${imagePath}`);
        }
    }

    for (const [char, resourceName] of Object.entries(characters.special || {})) {
        if (typeof resourceName !== 'string' || resourceName.trim() === '') {
            addError(alphabetId, `special "${char}" must point to a resource name`);
            continue;
        }
        const imagePath = `${config.imageDir}/${resourceName}.${config.imageFormat}`;
        if (!fileExists(alphabetDir, imagePath)) {
            addError(alphabetId, `missing image for special "${char}": ${imagePath}`);
        }
    }
}

for (const alphabetId of fs.readdirSync(alphabetsRoot)) {
    const alphabetDir = path.join(alphabetsRoot, alphabetId);
    const configPath = path.join(alphabetDir, 'alphabet.json');
    if (!fs.existsSync(configPath)) {
        continue;
    }

    let alphabet;
    try {
        alphabet = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        addError(alphabetId, `invalid JSON: ${error.message}`);
        continue;
    }

    const config = alphabet.alphabetConfig;
    if (!config || typeof config !== 'object') {
        addError(alphabetId, 'alphabetConfig is required');
        continue;
    }

    if (Object.prototype.hasOwnProperty.call(config, 'special')) {
        addError(alphabetId, 'alphabetConfig.special must be moved to alphabetConfig.characters.special');
    }

    const characters = config.characters;
    if (!characters || typeof characters !== 'object') {
        addError(alphabetId, 'alphabetConfig.characters is required');
        continue;
    }

    if (!isCharacterList(characters.letters)) {
        addError(alphabetId, 'characters.letters must be "all" or an array of strings');
    }
    if (!isCharacterList(characters.numbers)) {
        addError(alphabetId, 'characters.numbers must be "all" or an array of strings');
    }
    if (characters.special !== undefined && (typeof characters.special !== 'object' || Array.isArray(characters.special))) {
        addError(alphabetId, 'characters.special must be an object when present');
    }

    if (config.type === 'font') {
        if (!config.fontFile || typeof config.fontFile !== 'string') {
            addError(alphabetId, 'alphabetConfig.fontFile is required for font alphabets');
        } else {
            validateFontFile(alphabetId, alphabetDir, config.fontFile);
        }
    } else if (config.type === 'images') {
        validateImages(alphabetId, alphabetDir, config, characters);
    } else {
        addError(alphabetId, 'alphabetConfig.type must be "font" or "images"');
    }
}

if (errors.length > 0) {
    console.error(`Alphabet validation failed with ${errors.length} error(s):`);
    for (const error of errors) {
        console.error(`- ${error}`);
    }
    process.exit(1);
}

console.log('Alphabet validation passed.');
