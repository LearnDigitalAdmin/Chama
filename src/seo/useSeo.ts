import { useEffect } from 'react';
import { SITE } from './site';

export interface SeoInput {
  title: string;
  description: string;
  /** Path for canonical/og:url, e.g. "/". Ignored when noindex. */
  path?: string;
  noindex?: boolean;
  image?: string;
}

function meta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute('content', content);
}

function canonical(href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (href === null) { el?.remove(); return; }
  if (!el) { el = document.createElement('link'); el.rel = 'canonical'; document.head.appendChild(el); }
  el.href = href;
}

/** Updates the <head> tags that index.html ships statically. Imperative on purpose: no duplicate tags, no dependency. */
export function applySeo({ title, description, path = '/', noindex = false, image = SITE.ogImage }: SeoInput) {
  const url = SITE.url + path;
  const img = image.startsWith('http') ? image : SITE.url + image;
  document.title = title;
  meta('name', 'description', description);
  meta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
  canonical(noindex ? null : url);
  meta('property', 'og:title', title);
  meta('property', 'og:description', description);
  meta('property', 'og:url', url);
  meta('property', 'og:image', img);
  meta('name', 'twitter:title', title);
  meta('name', 'twitter:description', description);
  meta('name', 'twitter:image', img);
}

export function useSeo(input: SeoInput) {
  const { title, description, path, noindex, image } = input;
  useEffect(() => { applySeo({ title, description, path, noindex, image }); }, [title, description, path, noindex, image]);
}
