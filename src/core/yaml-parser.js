const fs = require('fs');
const path = require('path');

function parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter = match[1];
    const body = match[2].trim();

    const meta = {};
    let currentKey = null;

    for (const line of frontmatter.split('\n')) {
        const kvMatch = line.match(/^(\w+):\s*(.*)$/);
        if (kvMatch) {
            currentKey = kvMatch[1];
            if (kvMatch[2].trim()) {
                const val = kvMatch[2].trim().replace(/^["']|["']$/g, '');
                if (val === 'true') meta[currentKey] = true;
                else if (val === 'false') meta[currentKey] = false;
                else meta[currentKey] = val;
            }
        } else if (line.trim().startsWith('- ') && currentKey) {
            if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
            meta[currentKey].push(line.trim().replace(/^- /, '').replace(/^["']|["']$/g, ''));
        }
    }

    return { meta, body };
}

function scanSkillDir(dir, skills) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const skillFile = path.join(dir, entry.name, 'SKILL.md');
            if (fs.existsSync(skillFile)) {
                try {
                    const content = fs.readFileSync(skillFile, 'utf-8');
                    const parsed = parseFrontmatter(content);
                    if (parsed) {
                        skills.push({
                            id: entry.name,
                            name: parsed.meta.name || entry.name,
                            description: parsed.meta.description || '',
                            triggers: parsed.meta.triggers || [],
                            instructions: parsed.body
                        });
                    }
                } catch {}
            }
        }
    }
}

module.exports = { parseFrontmatter, scanSkillDir };
