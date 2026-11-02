ALTER TABLE website_content_pages
  DROP CONSTRAINT website_content_slug_allowed;

ALTER TABLE website_content_pages
  ADD CONSTRAINT website_content_slug_allowed CHECK (
    slug IN (
      'home', 'about', 'home-collection', 'faq', 'corporate', 'doctors', 'partners',
      'centres', 'service-areas', 'tests', 'packages', 'booking', 'contact'
    )
  );

COMMENT ON CONSTRAINT website_content_slug_allowed ON website_content_pages IS
  'Keep persisted website page slugs aligned with the public content API allowlist.';
