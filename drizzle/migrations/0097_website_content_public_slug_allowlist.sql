ALTER TABLE website_content_pages
  DROP CONSTRAINT website_content_slug_allowed;

ALTER TABLE website_content_pages
  ADD CONSTRAINT website_content_slug_allowed
  CHECK (slug IN (
    'home', 'about', 'home-collection', 'faq', 'corporate', 'doctors', 'partners',
    'centres', 'service-areas', 'tests', 'packages', 'booking', 'contact'
  ));

COMMENT ON CONSTRAINT website_content_slug_allowed ON website_content_pages IS
  'Only enumerated public informational pages may use editable website content. Legal/policy pages and arbitrary paths are excluded.';
