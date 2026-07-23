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

  const navbarLabels = [
    {
      href: "https://socq.ai",
      en: "Website",
      zh: "官网",
    },
    {
      href: "https://socq.ai/dashboard/api-key",
      en: "Get API key",
      zh: "获取 API Key",
    },
  ];
  let navbarSyncQueued = false;
  const getLocale = () =>
    window.location.pathname === "/zh" ||
    window.location.pathname.startsWith("/zh/")
      ? "zh"
      : "en";

  const syncNavbarLocale = () => {
    navbarSyncQueued = false;
    const locale = getLocale();

    navbarLabels.forEach((labels) => {
      document
        .querySelectorAll(`#navbar a[href="${labels.href}"]`)
        .forEach((link) => {
          if (link.querySelector("img")) return;

          const knownLabels = [labels.en, labels.zh];
          const leaf = Array.from(link.querySelectorAll("span")).find(
            (span) =>
              span.children.length === 0 &&
              knownLabels.includes(span.textContent.trim())
          );
          if (leaf && leaf.textContent !== labels[locale]) {
            leaf.textContent = labels[locale];
          } else if (
            !leaf &&
            knownLabels.includes(link.textContent.trim()) &&
            link.textContent !== labels[locale]
          ) {
            link.textContent = labels[locale];
          }
        });
    });
  };

  const queueNavbarSync = () => {
    if (navbarSyncQueued) return;
    navbarSyncQueued = true;
    queueMicrotask(syncNavbarLocale);
  };

  syncNavbarLocale();
  const bodyObserver = new MutationObserver(queueNavbarSync);
  bodyObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  document.addEventListener("click", (event) => {
    const languageItem = event.target.closest(
      '[id^="localization-select-item-"]'
    );
    if (!languageItem) return;

    const requestedLocale = languageItem.id.replace(
      "localization-select-item-",
      ""
    );
    if (!["en", "zh"].includes(requestedLocale)) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const currentPath = window.location.pathname;
    const englishPath =
      currentPath === "/zh"
        ? "/"
        : currentPath.startsWith("/zh/")
          ? currentPath.slice(3)
          : currentPath;
    const targetPath =
      requestedLocale === "zh"
        ? englishPath === "/"
          ? "/zh"
          : `/zh${englishPath}`
        : englishPath;

    window.location.assign(
      `${targetPath}${window.location.search}${window.location.hash}`
    );
  }, true);
})();
