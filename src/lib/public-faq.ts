export type PublicFaqItem = { question: string; answer: string; topic: string };

export function filterPublicFaq(items: readonly PublicFaqItem[], query: string, topic: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (topic !== "ALL" && item.topic !== topic) return false;
    if (!normalizedQuery) return true;
    return `${item.question} ${item.answer} ${item.topic}`.toLocaleLowerCase().includes(normalizedQuery);
  });
}
