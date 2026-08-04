// Shared helpers for login.html / signup.html

function showFieldError(inputEl, errEl, msg) {
  if (msg) {
    inputEl.classList.add('invalid');
    errEl.textContent = msg;
  } else {
    inputEl.classList.remove('invalid');
    errEl.textContent = '';
  }
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function wirePasswordToggle(toggleBtn, pwInput) {
  toggleBtn.addEventListener('click', () => {
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    toggleBtn.textContent = show ? 'Hide' : 'Show';
  });
}

// Guards a submit button: disables it while `fn` (async) is running,
// re-enables after — prevents double-submit on slow connections.
function guardSubmit(btn, fn) {
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span>Working…';
    try {
      await fn();
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

function showAuthError(box, msg) {
  box.textContent = msg;
  box.classList.add('show');
}
function hideAuthError(box) {
  box.classList.remove('show');
}

// If already signed in, skip straight to the app.
(async function redirectIfLoggedIn() {
  const { data } = await DataAPI.getSession();
  if (data) window.location.href = 'index.html';
})();
