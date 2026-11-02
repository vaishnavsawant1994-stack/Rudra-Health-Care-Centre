export function ErrorState({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="error-state" role="status"><strong>{title}</strong><p>{children}</p></section>;
}
