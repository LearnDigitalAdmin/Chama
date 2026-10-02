import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { SEO_COPY } from '../marketing/content';
import { applySeo } from './useSeo';
import { PRIVATE_PATH_PREFIXES } from './site';

/** One place that keeps <head> correct on every client-side navigation. Mount once inside the Router. */
export default function RouteSeo() {
  const { pathname } = useLocation();
  useEffect(() => {
    const isPrivate = PRIVATE_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
    if (isPrivate) {
      applySeo({ title: 'MyChama', description: SEO_COPY.description, noindex: true });
    } else {
      applySeo({ title: SEO_COPY.title, description: SEO_COPY.description, path: '/' });
    }
  }, [pathname]);
  return null;
}
