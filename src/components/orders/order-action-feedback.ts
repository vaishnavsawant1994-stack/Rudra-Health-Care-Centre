export function orderActionFeedback(outcome: "saved" | "unconfirmed", detailsRefreshed: boolean) {
  if (outcome === "saved" && detailsRefreshed) return "Order updated successfully.";
  if (outcome === "saved") return "Order action was saved, but updated details could not be loaded. Refresh the order before taking another action.";
  return "Order update could not be confirmed. Refresh the order before retrying.";
}
