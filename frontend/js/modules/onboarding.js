// onboarding.js - First-run guided intro

const ONBOARDING_KEY = "stim_app_onboarding_done_v1";

function isOnboardingDone() {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch (e) {
    return false;
  }
}

function markOnboardingDone() {
  try {
    localStorage.setItem(ONBOARDING_KEY, "1");
  } catch (e) {
    // ignore
  }
}

function showOnboarding(force = false) {
  if (!force && isOnboardingDone()) return;
  const overlay = document.getElementById("onboarding-overlay");
  if (!overlay) return;
  overlay.style.display = "flex";
  goOnboardingStep(0);
}

function hideOnboarding() {
  const overlay = document.getElementById("onboarding-overlay");
  if (overlay) overlay.style.display = "none";
  markOnboardingDone();
}

function goOnboardingStep(step) {
  const steps = document.querySelectorAll(".onboarding-step");
  const max = steps.length - 1;
  const idx = Math.max(0, Math.min(max, step));
  AppState.onboardingStep = idx;
  steps.forEach((el) => {
    el.style.display = String(el.getAttribute("data-step")) === String(idx) ? "block" : "none";
  });
  const dots = document.getElementById("onboarding-dots");
  if (dots) {
    dots.innerHTML = "";
    for (let i = 0; i <= max; i++) {
      const d = document.createElement("span");
      d.className = "onboarding-dot" + (i === idx ? " active" : "");
      dots.appendChild(d);
    }
  }
  const nextBtn = document.getElementById("onboarding-next");
  if (nextBtn) nextBtn.textContent = idx >= max ? "Fertig" : "Weiter";
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("onboarding-skip")?.addEventListener("click", () => {
    hideOnboarding();
  });
  document.getElementById("onboarding-next")?.addEventListener("click", () => {
    const steps = document.querySelectorAll(".onboarding-step");
    const max = steps.length - 1;
    const cur = AppState.onboardingStep || 0;
    if (cur >= max) {
      hideOnboarding();
      return;
    }
    goOnboardingStep(cur + 1);
  });
  document.getElementById("btn-show-onboarding")?.addEventListener("click", () => {
    showOnboarding(true);
  });

  // First run
  setTimeout(() => showOnboarding(false), 400);
});

window.showOnboarding = showOnboarding;
