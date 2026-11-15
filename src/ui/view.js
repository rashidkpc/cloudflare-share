// Countdown for the share header.
for (const element of document.querySelectorAll("[data-expires-at]")) {
  const expiresAt = Number(element.getAttribute("data-expires-at"));

  const tick = () => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      element.textContent = "expired";
      element.classList.add("expired");
      clearInterval(timer);
      location.reload();
      return;
    }

    const seconds = Math.floor(remaining / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (days > 0) element.textContent = days + "d " + hours + "h";
    else if (hours > 0) element.textContent = hours + "h " + minutes + "m";
    else if (minutes > 0) element.textContent = minutes + "m " + secs + "s";
    else element.textContent = secs + "s";
  };

  tick();
  const timer = setInterval(tick, 1000);
}

const thumbs = [...document.querySelectorAll(".thumb")];

if (thumbs.length > 0) {
  const box = document.createElement("div");
  box.className = "lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Image viewer");
  box.innerHTML =
    '<button type="button" class="lightbox-close" aria-label="Close">×</button>' +
    '<button type="button" class="lightbox-prev" aria-label="Previous">‹</button>' +
    '<button type="button" class="lightbox-next" aria-label="Next">›</button>' +
    '<div class="lightbox-viewport"><div class="lightbox-track"></div></div>' +
    '<div class="lightbox-dots"></div>';
  document.body.append(box);

  const track = box.querySelector(".lightbox-track");
  const dots = box.querySelector(".lightbox-dots");
  const prevButton = box.querySelector(".lightbox-prev");
  const nextButton = box.querySelector(".lightbox-next");
  const closeButton = box.querySelector(".lightbox-close");

  const images = thumbs.map((thumb) => {
    const slide = document.createElement("div");
    slide.className = "lightbox-slide";

    const image = document.createElement("img");
    image.alt = thumb.dataset.name || "";
    image.decoding = "async";
    image.loading = "lazy";
    image.draggable = false;

    slide.append(image);
    track.append(slide);
    return image;
  });

  const dotsList = thumbs.map((_, dotIndex) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "lightbox-dot";
    dot.setAttribute("aria-label", "Image " + (dotIndex + 1));
    dot.addEventListener("click", (event) => {
      event.stopPropagation();
      jump(dotIndex);
    });
    dots.append(dot);
    return dot;
  });

  let index = 0;
  let dragging = false;
  let swiped = false;
  let startX = 0;
  let startY = 0;
  let dragX = 0;
  let dragY = 0;

  const isOpen = () => box.classList.contains("open");

  function ensure(dotIndex) {
    if (dotIndex < 0 || dotIndex >= thumbs.length) return;
    if (!images[dotIndex].src) {
      images[dotIndex].src = thumbs[dotIndex].dataset.full;
    }
  }

  function render() {
    track.style.transform = "translateX(" + -index * 100 + "%)";
    dotsList.forEach((dot, dotIndex) => {
      dot.classList.toggle("active", dotIndex === index);
    });
    prevButton.hidden = index === 0;
    nextButton.hidden = index === thumbs.length - 1;
  }

  function open(nextIndex) {
    index = nextIndex;
    swiped = false;

    ensure(index);
    ensure(index + 1);
    ensure(index - 1);

    track.style.transition = "none";
    render();
    void track.offsetWidth;

    box.classList.add("open");
    document.body.classList.add("lightbox-open");
  }

  function close() {
    if (!isOpen()) return;
    box.classList.remove("open");
    document.body.classList.remove("lightbox-open");
  }

  function go(direction, wrap) {
    let nextIndex = index + direction;

    if (wrap) {
      nextIndex = (nextIndex + thumbs.length) % thumbs.length;
    } else if (nextIndex < 0 || nextIndex >= thumbs.length) {
      return;
    }

    index = nextIndex;
    ensure(index);
    ensure(index + 1);
    ensure(index - 1);

    track.style.transition = "transform 0.3s ease";
    render();
  }

  function jump(nextIndex) {
    index = nextIndex;
    ensure(index);
    ensure(index + 1);
    ensure(index - 1);
    track.style.transition = "transform 0.3s ease";
    render();
  }

  thumbs.forEach((thumb, thumbIndex) => {
    thumb.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      open(thumbIndex);
    });
  });

  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });

  prevButton.addEventListener("click", (event) => {
    event.stopPropagation();
    go(-1, false);
  });

  nextButton.addEventListener("click", (event) => {
    event.stopPropagation();
    go(1, false);
  });

  // Clicking anywhere dismisses.
  box.addEventListener("click", (event) => {
    event.preventDefault();
    if (swiped) return;
    close();
  });

  document.addEventListener("keydown", (event) => {
    if (!isOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1, true);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1, true);
    }
  });

  function trackTransform() {
    return "translateX(calc(" + -index * 100 + "% + " + dragX + "px))";
  }

  box.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1) return;
      dragging = true;
      swiped = false;
      dragX = 0;
      dragY = 0;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      track.style.transition = "none";
    },
    { passive: true },
  );

  box.addEventListener(
    "touchmove",
    (event) => {
      if (!dragging || event.touches.length !== 1) return;
      dragX = event.touches[0].clientX - startX;
      dragY = event.touches[0].clientY - startY;
      track.style.transform = trackTransform();
    },
    { passive: true },
  );

  box.addEventListener(
    "touchend",
    () => {
      if (!dragging) return;
      dragging = false;

      if (dragY > 100) {
        close();
        return;
      }

      if (Math.abs(dragX) > 50) {
        swiped = true;
        go(dragX < 0 ? 1 : -1, false);
        window.setTimeout(() => {
          swiped = false;
        }, 350);
      } else {
        track.style.transition = "transform 0.2s ease";
        render();
      }

      dragX = 0;
      dragY = 0;
    },
    { passive: true },
  );
}
