import { access, readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';

const root = process.cwd();
const publicPages = [
  'index.html',
  'solutions/index.html',
  'industries/index.html',
  'projects-showcase/index.html',
  'about/index.html',
  'contact/index.html',
  '404.html'
];

const failures = [];
const pageCache = new Map();

const loadPage = async file => {
  if (!pageCache.has(file)) pageCache.set(file, await readFile(resolve(root, file), 'utf8'));
  return pageCache.get(file);
};

const rootTarget = urlPath => {
  const clean = urlPath.split('?')[0].split('#')[0];
  if (clean === '/') return 'index.html';
  if (extname(clean)) return clean.replace(/^\//, '');
  return `${clean.replace(/^\//, '').replace(/\/$/, '')}/index.html`;
};

for (const page of publicPages) {
  const html = await loadPage(page);
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) failures.push(`${page}: expected one h1, found ${h1Count}`);
  if (!/<title>[^<]+<\/title>/i.test(html)) failures.push(`${page}: missing title`);
  if (!/<html\s+lang="en-ZA"/i.test(html)) failures.push(`${page}: missing en-ZA language`);
  if (page !== '404.html' && !/<meta\s+name="description"/i.test(html)) failures.push(`${page}: missing meta description`);

  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\salt="[^"]*"/i.test(tag[0])) failures.push(`${page}: image missing alt attribute`);
  }

  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/gi)) {
    const value = match[1];
    if (/^(?:https?:|mailto:|tel:|data:|#)/i.test(value)) continue;
    const pathOnly = value.split('?')[0].split('#')[0];
    const target = value.startsWith('/') ? rootTarget(value) : resolve(dirname(page), pathOnly).replace(`${root}/`, '');
    try { await access(resolve(root, target)); } catch { failures.push(`${page}: missing local target ${value}`); }

    const hash = value.includes('#') ? value.split('#')[1] : '';
    if (hash) {
      const targetHtml = await loadPage(target);
      if (!new RegExp(`id=["']${hash}["']`).test(targetHtml)) failures.push(`${page}: missing anchor #${hash} in ${target}`);
    }
  }
}

const allPublicHtml = (await Promise.all(publicPages.map(loadPage))).join('\n');
const requiredLinks = [
  'https://forms.clickup.com/9005033045/f/8cbvtjn-18752/3LKGNJRJUHH1JIBOLT',
  'https://wa.me/27614555652',
  'tel:+27614555652',
  'mailto:jennifer.vl@optistratsolutions.co.za'
];

for (const link of requiredLinks) {
  if (!allPublicHtml.includes(link)) failures.push(`required contact link not found: ${link}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`QA passed for ${publicPages.length} public pages.`);
