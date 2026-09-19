function initHeadingAnchors(): void {
  document.querySelectorAll<HTMLElement>(".heading-copy").forEach((heading) => {
    heading.addEventListener("click", async (e) => {
      if ((e.target as HTMLElement).closest("a")) return;
      const url = `${window.location.origin}${window.location.pathname}#${heading.id}`;
      history.replaceState(null, "", `#${heading.id}`);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // Clipboard API unavailable (e.g. insecure context); URL fragment still updated.
      }
    });
  });
}

initHeadingAnchors();
