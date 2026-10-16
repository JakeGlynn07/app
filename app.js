(() => {
  'use strict';

  /* ------------------------------------------------------------------
     Config
     ------------------------------------------------------------------ */
  const API = 'https://dog.ceo/api';
  const ROUNDS = 10;
  const OPTION_COUNT = 4;
  const BEST_KEY = 'pupquiz-best';

  /* ------------------------------------------------------------------
     Breed names
     The API uses folder names like "hound-afghan" (breed-subbreed).
     These helpers turn them into readable names like "Afghan Hound".
     ------------------------------------------------------------------ */
  const PREFIX_FIRST = new Set(['australian', 'finnish', 'swedish']);

  const NAME_FIXES = {
    germanshepherd: 'German Shepherd',
    stbernard: 'St. Bernard',
    shihtzu: 'Shih Tzu',
    sharpei: 'Shar Pei',
    cotondetulear: 'Coton de Tulear',
    mexicanhairless: 'Mexican Hairless',
    'mountain-bernese': 'Bernese Mountain Dog',
    'mountain-swiss': 'Swiss Mountain Dog',
    'springer-english': 'English Springer Spaniel',
    'cattledog-australian': 'Australian Cattle Dog',
    'hound-blood': 'Bloodhound',
    'mastiff-bull': 'Bullmastiff',
    'terrier-westhighland': 'West Highland Terrier',
    'retriever-flatcoated': 'Flat-Coated Retriever',
    'pointer-germanlonghair': 'German Longhaired Pointer'
  };

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function displayName(breed, sub) {
    const key = sub ? `${breed}-${sub}` : breed;
    if (NAME_FIXES[key]) return NAME_FIXES[key];
    if (!sub) return cap(breed);
    return PREFIX_FIRST.has(breed)
      ? `${cap(breed)} ${cap(sub)}`
      : `${cap(sub)} ${cap(breed)}`;
  }

  // Pull the breed out of an image URL such as
  // https://images.dog.ceo/breeds/hound-afghan/n02088094_1003.jpg
  function breedFromImageUrl(url) {
    const match = url.match(/\/breeds\/([^/]+)\//);
    if (!match) return null;
    const folder = match[1];
    const dash = folder.indexOf('-');
    return dash === -1
      ? displayName(folder, null)
      : displayName(folder.slice(0, dash), folder.slice(dash + 1));
  }

  /* ------------------------------------------------------------------
     Elements
     ------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);

  const screens = {
    menu: $('menu-screen'),
    game: $('game-screen'),
    results: $('results-screen')
  };

  const photoEl = $('photo');
  const imgEl = $('dog-img');
  const optionsEl = $('options');
  const feedbackEl = $('feedback');
  const nextBtn = $('next-btn');
  const errorBox = $('error-box');

  /* ------------------------------------------------------------------
     State
     ------------------------------------------------------------------ */
  let breedNames = [];          // every breed name from the API
  let usedAnswers = new Set();  // breeds already shown this game
  let runId = 0;                // changes whenever a game starts or is quit
  let prefetch = null;          // { run, promise } for the next question
  let current = null;           // the question on screen
  let round = 0;
  let score = 0;
  let streak = 0;
  let bestStreak = 0;
  let locked = true;            // true while answers are not accepted

  /* ------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------ */
  function shuffle(array) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.hidden = key !== name;
    });
  }

  function readBest() {
    try {
      const value = Number(localStorage.getItem(BEST_KEY));
      return Number.isFinite(value) ? value : 0;
    } catch (e) {
      return 0;
    }
  }

  function saveBest(value) {
    try { localStorage.setItem(BEST_KEY, String(value)); } catch (e) { /* ignore */ }
  }

  function updateBestLine() {
    const best = readBest();
    const line = $('best-line');
    line.hidden = best === 0;
    line.textContent = `Best score: ${best} / ${ROUNDS}`;
  }

  /* ------------------------------------------------------------------
     API calls
     ------------------------------------------------------------------ */
  async function fetchJSON(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadBreeds() {
    if (breedNames.length) return;
    const data = await fetchJSON(`${API}/breeds/list/all`);
    const names = new Set();
    Object.entries(data.message).forEach(([breed, subs]) => {
      if (subs.length === 0) {
        names.add(displayName(breed, null));
      } else {
        subs.forEach((sub) => names.add(displayName(breed, sub)));
      }
    });
    breedNames = Array.from(names);
  }

  function preloadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image failed to load'));
      img.src = url;
    });
  }

  // Fetch a random dog photo and build the multiple-choice options.
  async function buildQuestion(run) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const data = await fetchJSON(`${API}/breeds/image/random`);
      const url = data.message;
      const answer = breedFromImageUrl(url);

      if (!answer || usedAnswers.has(answer)) continue;

      try {
        await preloadImage(url);
      } catch (e) {
        continue;
      }

      if (run === runId) usedAnswers.add(answer);

      const wrong = shuffle(breedNames.filter((n) => n !== answer)).slice(0, OPTION_COUNT - 1);
      return { url, answer, options: shuffle([answer, ...wrong]) };
    }
    throw new Error('Could not load a new dog photo.');
  }

  /* ------------------------------------------------------------------
     Game flow
     ------------------------------------------------------------------ */
  function startGame() {
    runId++;
    usedAnswers = new Set();
    prefetch = null;
    current = null;
    round = 0;
    score = 0;
    streak = 0;
    bestStreak = 0;

    $('score-label').textContent = '0';
    $('streak-label').textContent = '0';
    showScreen('game');
    nextRound();
  }

  function setLoading(isLoading) {
    photoEl.classList.toggle('loading', isLoading);
  }

  async function nextRound() {
    const run = runId;
    const number = round + 1;

    locked = true;
    errorBox.hidden = true;
    nextBtn.hidden = true;
    feedbackEl.textContent = '';
    feedbackEl.className = 'feedback';
    optionsEl.textContent = '';
    setLoading(true);

    $('round-label').textContent = `${number} / ${ROUNDS}`;
    $('progress-bar').style.width = `${((number - 1) / ROUNDS) * 100}%`;

    try {
      await loadBreeds();

      let question = null;
      if (prefetch && prefetch.run === run) {
        try { question = await prefetch.promise; } catch (e) { question = null; }
      }
      prefetch = null;
      if (!question) question = await buildQuestion(run);

      if (run !== runId) return; // game was quit or restarted meanwhile

      round = number;
      current = question;
      renderQuestion();

      // Start fetching the following dog while the player thinks.
      if (round < ROUNDS) {
        const promise = buildQuestion(run);
        promise.catch(() => {}); // errors are handled when it is used
        prefetch = { run, promise };
      }
    } catch (err) {
      if (run !== runId) return;
      setLoading(false);
      imgEl.removeAttribute('src');
      $('error-text').textContent = navigator.onLine === false
        ? 'You appear to be offline. Pup Quiz needs the internet to fetch dog photos.'
        : 'Could not reach the dog photo service. Please try again.';
      errorBox.hidden = false;
    }
  }

  function renderQuestion() {
    imgEl.src = current.url;
    setLoading(false);

    current.options.forEach((name, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';

      const key = document.createElement('span');
      key.className = 'option-key';
      key.textContent = String(index + 1);

      const label = document.createElement('span');
      label.textContent = name;

      btn.append(key, label);
      btn.addEventListener('click', () => answer(index));
      optionsEl.appendChild(btn);
    });

    locked = false;
  }

  function answer(index) {
    if (locked || !current) return;
    locked = true;

    const chosen = current.options[index];
    const correct = chosen === current.answer;
    const buttons = Array.from(optionsEl.children);

    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (current.options[i] === current.answer) {
        btn.classList.add('correct');
      } else if (i === index) {
        btn.classList.add('wrong');
      } else {
        btn.classList.add('dim');
      }
    });

    if (correct) {
      score++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      feedbackEl.textContent = streak >= 3 ? `Correct! ${streak} in a row.` : 'Correct!';
      feedbackEl.className = 'feedback good';
    } else {
      streak = 0;
      feedbackEl.textContent = `Not quite. That was a ${current.answer}.`;
      feedbackEl.className = 'feedback bad';
    }

    $('score-label').textContent = String(score);
    $('streak-label').textContent = String(streak);
    $('progress-bar').style.width = `${(round / ROUNDS) * 100}%`;

    nextBtn.textContent = round >= ROUNDS ? 'See results' : 'Next dog';
    nextBtn.hidden = false;
    nextBtn.focus();
  }

  function finishGame() {
    const previousBest = readBest();
    const newBest = score > previousBest;
    if (newBest) saveBest(score);

    let title;
    if (score === ROUNDS) title = 'Perfect! A true dog whisperer.';
    else if (score >= 8) title = 'Impressive! You know your breeds.';
    else if (score >= 5) title = 'Good effort! Keep sniffing around.';
    else title = 'Ruff round. Try again!';

    $('results-title').textContent = title;
    $('results-sub').textContent = newBest && previousBest > 0
      ? 'That is a new personal best.'
      : 'Here is how you did.';
    $('result-score').textContent = `${score}/${ROUNDS}`;
    $('result-streak').textContent = String(bestStreak);
    $('result-best').textContent = `${Math.max(score, previousBest)}/${ROUNDS}`;

    showScreen('results');
    $('again-btn').focus();
  }

  /* ------------------------------------------------------------------
     Buttons and keyboard
     ------------------------------------------------------------------ */
  $('start-btn').addEventListener('click', startGame);
  $('again-btn').addEventListener('click', startGame);

  $('menu-btn').addEventListener('click', () => {
    updateBestLine();
    showScreen('menu');
  });

  $('quit-btn').addEventListener('click', () => {
    runId++;
    prefetch = null;
    updateBestLine();
    showScreen('menu');
  });

  $('retry-btn').addEventListener('click', nextRound);

  nextBtn.addEventListener('click', () => {
    if (round >= ROUNDS) finishGame();
    else nextRound();
  });

  document.addEventListener('keydown', (e) => {
    if (screens.game.hidden) return;

    if (e.key >= '1' && e.key <= String(OPTION_COUNT)) {
      answer(Number(e.key) - 1);
    } else if (e.key === 'Enter' && !nextBtn.hidden && e.target.tagName !== 'BUTTON') {
      nextBtn.click();
    }
  });

  updateBestLine();
  showScreen('menu');
})();
