(() => {
  const faviconSources = [
    {
      href: "/assets/socq-logo-light.png",
      media: "(prefers-color-scheme: light)",
    },
    {
      href: "/assets/socq-logo-dark.png",
      media: "(prefers-color-scheme: dark)",
    },
  ];

  let syncQueued = false;

  const syncFavicons = () => {
    syncQueued = false;

    const current = Array.from(
      document.head.querySelectorAll('link[rel~="icon"]')
    );
    const isCurrent =
      current.length === faviconSources.length &&
      faviconSources.every(({ href, media }) =>
        current.some(
          (link) =>
            link.dataset.socqFavicon === "true" &&
            link.getAttribute("href") === href &&
            link.getAttribute("media") === media
        )
      );

    if (isCurrent) {
      return;
    }

    current.forEach((link) => link.remove());

    faviconSources.forEach(({ href, media }) => {
      const link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/png";
      link.href = href;
      link.media = media;
      link.dataset.socqFavicon = "true";
      document.head.appendChild(link);
    });
  };

  const queueFaviconSync = () => {
    if (syncQueued) {
      return;
    }

    syncQueued = true;
    queueMicrotask(syncFavicons);
  };

  syncFavicons();

  const headObserver = new MutationObserver(queueFaviconSync);
  headObserver.observe(document.head, {
    childList: true,
  });
})();
