export function nextActionAfterDecision(snapshot) {
  if (snapshot.isLastItem) {
    return "finish";
  }
  if (snapshot.submitButton && !snapshot.nextButton) {
    return "suspend";
  }
  if (!snapshot.nextButton) {
    return "wait";
  }
  return "next";
}
