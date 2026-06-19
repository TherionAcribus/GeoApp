#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const alphabetsRoot = path.join(repoRoot, 'alphabets');
const errors = [];

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
        } else if (!fileExists(alphabetDir, config.fontFile)) {
            addError(alphabetId, `font file not found: ${config.fontFile}`);
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
