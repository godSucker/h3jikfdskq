<script lang="ts">
  import { textureUrl } from '@/lib/texture-cdn';
  import { t, type Locale } from '@/lib/i18n';

  let { locale = 'ru' as Locale }: { locale?: Locale } = $props();

  // Личные био команды - авторский неигровой контент (без официального
  // источника). По решению пользователя (2026-08-15) переведён через LLM,
  // с сохранением тона по возможности - в отличие от игровых данных, где
  // LLM-перевод/имена запрещены правилом проекта (см. память
  // feedback-no-llm-authored-names). Имена/ники людей НЕ переводятся ни в
  // одном языке.
  interface TeamI18nEntry {
    role: string;
    desc: string;
  }
  const TEAM_I18N: Record<string, Partial<Record<Locale, TeamI18nEntry>>> = {
    garan: {
      en: { role: 'Founder & Lead Developer', desc: "Every bug on the site is on his conscience (he has none). For bug reports, suggestions and wishes, reach out on Telegram." },
      es: { role: 'Fundador y desarrollador principal', desc: 'Cada bug del sitio pesa sobre su conciencia (no tiene). Para bugs encontrados, sugerencias y deseos, escribe por Telegram.' },
      fr: { role: 'Fondateur et développeur principal', desc: "Chaque bug du site pèse sur sa conscience (il n'en a pas). Pour les bugs trouvés, suggestions et souhaits, contactez-le sur Telegram." },
      de: { role: 'Gründer & Lead-Entwickler', desc: 'Jeder Bug auf der Seite liegt auf seinem Gewissen (das er nicht hat). Bei gefundenen Bugs, Vorschlägen und Wünschen bitte über Telegram melden.' },
      pt: { role: 'Fundador e desenvolvedor principal', desc: 'Cada bug do site pesa na consciência dele (que ele não tem). Para bugs encontrados, sugestões e pedidos, fale no Telegram.' },
      it: { role: 'Fondatore e sviluppatore principale', desc: 'Ogni bug del sito pesa sulla sua coscienza (che non ha). Per bug trovati, suggerimenti e richieste, scrivi su Telegram.' },
      tr: { role: 'Kurucu ve Baş Geliştirici', desc: "Sitedeki her hata onun vicdanında (ki yoktur). Bulduğunuz hatalar, öneriler ve istekler için Telegram'dan ulaşın." },
      nl: { role: 'Oprichter & Lead Developer', desc: 'Elke bug op de site drukt op zijn geweten (dat hij niet heeft). Voor gevonden bugs, suggesties en wensen, neem contact op via Telegram.' },
    },
    donutsafe: {
      en: { role: 'Sponsor & Keeper of the Project', desc: 'A true archivist of information and a generator of ideas, helped at every stage of development, and also funds in-game purchases in games (MGG, Genshin, etc.)' },
      es: { role: 'Patrocinador y guardián del proyecto', desc: 'Un verdadero archivista de la información y generador de ideas, ayudó en cada etapa del desarrollo y también invierte en compras dentro de los juegos (MGG, Genshin, etc.)' },
      fr: { role: 'Sponsor et gardien du projet', desc: "Un véritable archiviste de l'information et générateur d'idées, il a aidé à chaque étape du développement et finance aussi des achats in-game (MGG, Genshin, etc.)" },
      de: { role: 'Sponsor & Hüter des Projekts', desc: 'Ein echter Archivar des Wissens und Ideengeber, half in jeder Entwicklungsphase und finanziert außerdem In-Game-Käufe in Spielen (MGG, Genshin usw.)' },
      pt: { role: 'Patrocinador e guardião do projeto', desc: 'Um verdadeiro arquivista de informações e gerador de ideias, ajudou em cada etapa do desenvolvimento e também investe em compras dentro de jogos (MGG, Genshin etc.)' },
      it: { role: 'Sponsor e custode del progetto', desc: "Un vero archivista dell'informazione e generatore di idee, ha aiutato in ogni fase dello sviluppo e finanzia anche acquisti in-game (MGG, Genshin, ecc.)" },
      tr: { role: 'Sponsor ve Projenin Bekçisi', desc: 'Gerçek bir bilgi arşivcisi ve fikir üreticisi, gelişimin her aşamasında yardımcı oldu, ayrıca oyunlarda (MGG, Genshin vb.) harcama yapıyor.' },
      nl: { role: 'Sponsor & Hoeder van het project', desc: 'Een ware archivaris van informatie en ideeëngenerator, hielp bij elke fase van de ontwikkeling en steekt ook geld in in-game aankopen (MGG, Genshin, etc.)' },
    },
    imashio: {
      en: { role: 'Developer of the Base Simulator Versions', desc: 'Helped develop every simulator on this site and an incredible hard worker.' },
      es: { role: 'Desarrollador de las versiones base de los simuladores', desc: 'Ayudó a desarrollar cada simulador de este sitio y es un trabajador increíble.' },
      fr: { role: 'Développeur des versions de base des simulateurs', desc: "A aidé à développer chaque simulateur de ce site et c'est un travailleur incroyable." },
      de: { role: 'Entwickler der Basisversionen der Simulatoren', desc: 'Half bei der Entwicklung jedes Simulators auf dieser Seite und ist ein unglaublicher Arbeiter.' },
      pt: { role: 'Desenvolvedor das versões base dos simuladores', desc: 'Ajudou a desenvolver cada simulador deste site e é um trabalhador incrível.' },
      it: { role: 'Sviluppatore delle versioni base dei simulatori', desc: 'Ha aiutato a sviluppare ogni simulatore di questo sito ed è un lavoratore incredibile.' },
      tr: { role: 'Simülatörlerin Temel Sürümlerinin Geliştiricisi', desc: 'Bu sitedeki her simülatörün geliştirilmesine yardımcı oldu ve inanılmaz bir çalışkan.' },
      nl: { role: 'Ontwikkelaar van de basisversies van de simulators', desc: 'Hielp bij de ontwikkeling van elke simulator op deze site en is een ongelooflijke harde werker.' },
    },
    meegee: {
      en: { role: 'Contributor', desc: 'An incredible motivator and just a good person.' },
      es: { role: 'Colaborador', desc: 'Un motivador increíble y simplemente una buena persona.' },
      fr: { role: 'Contributeur', desc: "Un motivateur incroyable et tout simplement quelqu'un de bien." },
      de: { role: 'Mitwirkender', desc: 'Ein unglaublicher Motivator und einfach ein guter Mensch.' },
      pt: { role: 'Contribuidor', desc: 'Um motivador incrível e simplesmente uma boa pessoa.' },
      it: { role: 'Collaboratore', desc: 'Un motivatore incredibile e semplicemente una brava persona.' },
      tr: { role: 'Katkıda Bulunan', desc: 'İnanılmaz bir motivatör ve sadece iyi bir insan.' },
      nl: { role: 'Bijdrager', desc: 'Een ongelooflijke motivator en gewoon een goed mens.' },
    },
    ctrlcv: {
      en: { role: 'Contributor', desc: 'Hammered the keyboard into every crack between the keys just to get the site running as soon as possible.' },
      es: { role: 'Colaborador', desc: 'Le dio tan duro al teclado que se metió hasta en las rendijas entre las teclas, todo para que el sitio arrancara lo antes posible.' },
      fr: { role: 'Contributeur', desc: "A tapé sur le clavier si fort que ça s'est infiltré dans chaque interstice entre les touches, tout ça pour que le site démarre au plus vite." },
      de: { role: 'Mitwirkender', desc: 'Hat so hart auf die Tastatur eingedroschen, dass es in jede Ritze zwischen den Tasten kam - alles, damit die Seite so schnell wie möglich an den Start ging.' },
      pt: { role: 'Contribuidor', desc: 'Bateu tanto no teclado que entrou em cada frestinha entre as teclas, tudo para o site entrar no ar o quanto antes.' },
      it: { role: 'Collaboratore', desc: 'Ha martellato la tastiera fino a farla entrare in ogni fessura tra i tasti, tutto pur di far partire il sito il prima possibile.' },
      tr: { role: 'Katkıda Bulunan', desc: 'Site bir an önce çalışsın diye klavyeyi tuşların arasındaki her boşluğa girecek kadar dövdü.' },
      nl: { role: 'Bijdrager', desc: 'Beukte zo hard op het toetsenbord dat het in elke kier tussen de toetsen kroop, allemaal om de site zo snel mogelijk aan de praat te krijgen.' },
    },
    egor: {
      en: { role: 'One of the Lead Beta Testers', desc: 'Thoroughly tested the site inside and out, and just a great helper.' },
      es: { role: 'Uno de los principales beta testers', desc: 'La persona que probó el sitio a fondo y, simplemente, un gran ayudante.' },
      fr: { role: 'L’un des principaux bêta-testeurs', desc: 'La personne qui a testé le site de fond en comble, tout simplement un excellent assistant.' },
      de: { role: 'Einer der führenden Beta-Tester', desc: 'Hat die Seite bis ins letzte Detail getestet und ist einfach ein großartiger Helfer.' },
      pt: { role: 'Um dos principais beta testers', desc: 'A pessoa que testou o site minuciosamente e simplesmente um ótimo ajudante.' },
      it: { role: 'Uno dei principali beta tester', desc: 'La persona che ha testato il sito a fondo e semplicemente un grande aiuto.' },
      tr: { role: 'Başlıca Beta Test Uzmanlarından Biri', desc: 'Siteyi baştan sona titizlikle test eden ve sadece harika bir yardımcı.' },
      nl: { role: 'Een van de belangrijkste bètatesters', desc: 'De persoon die de site grondig heeft getest en gewoon een geweldige hulp.' },
    },
  };

  function localizeMember<T extends { id: string; role: string; desc: string }>(m: T): T {
    if (locale === 'ru') return m;
    const tr = TEAM_I18N[m.id]?.[locale];
    if (!tr) return m;
    return { ...m, role: tr.role, desc: tr.desc };
  }

  const teamMembersRaw = [
    {
      id: "garan",
      name: "がらんの画眉丸",
      role: "Основатель & Главный разработчик",
      desc: "Каждый баг на сайте лежит на его совести(ее нет). По поводу найденных багов, предложений и пожеланий обращаться в телеграмм",
      color: "platinum",
      avatar: "avatars/my_avatar.jpg",
      socials: [
        { name: "Telegram", url: "https://t.me/absolutely_poxuy" }
      ]
    },
    {
      id: "donutsafe",
      name: "Евгений aka DonutSafe",
      role: "Спонсор и хранитель проекта",
      desc: "Настоящий архивариус информации и генератор идей, помогал на каждой стадии разработки, так же занимается донатом в игры(MGG, Genshin etc)",
      color: "blue",
      avatar: "avatars/jenya_avatar.jpg",
      socials: [
        { name: "Telegram", url: "https://t.me/Donut_Safe" },
        { name: "ВК", url: "https://vk.com/id187030288" }
      ]
    },
    {
      id: "imashio",
      name: "imashio",
      role: "Разработчик базовых версий симуляторов",
      desc: "Помогал в разработке каждого симулятора на этом сайте и невероятный трудяга",
      color: "gold",
      avatar: "avatars/blind_avatar.jpg",
      socials: [
        { name: "Telegram", url: "https://t.me/blindpain" }
      ]
    },
    {
      id: "meegee",
      name: "ミーギー",
      role: "Контрибьютор",
      desc: "Невероятный мотиватор и просто хороший человек",
      color: "purple",
      avatar: "avatars/mege_avatar.jpg",
      socials: [
        { name: "Telegram", url: "https://t.me/meeggee" }
      ]
    },
    {
      id: "ctrlcv",
      name: "Ctrl+C Ctrl + V Master",
      role: "Контрибьютор",
      desc: "Оттарабанил клавиатуру во все щелочки между клавишами, чтобы работа сайта началась как можно скорее",
      color: "green",
      avatar: "avatars/german_avatar.jpg",
      socials: [
      ]
    },
    {
      id: "egor",
      name: "Егор",
      role: "Один из ведущих бета-тестеров",
      desc: "Человек который досконально проверял сайт и просто хороший помощник ",
      color: "red",
      avatar: "avatars/egor_avatar.jpg",
      socials: [
        { name: "Telegram", url: "https://t.me/+79014144308" }
      ]
    },
  ];

  const teamMembers = teamMembersRaw.map(localizeMember).map((m) => ({
    ...m,
    socials: m.socials.map((s) => (s.name === 'ВК' && locale !== 'ru' ? { ...s, name: 'VK' } : s)),
  }));

  // Цвета для рангов (как в игре)
  const colors = {
    gold: "linear-gradient(135deg, #fbbf24, #d97706)",
    platinum: "linear-gradient(135deg, #e2e8f0, #94a3b8)",
    purple: "linear-gradient(135deg, #c084fc, #7c3aed)",
    blue: "linear-gradient(135deg, #38bdf8, #2563eb)",
    green: "linear-gradient(135deg, #4ade80, #059669)",
    red: "linear-gradient(135deg, #f87171, #dc2626)",
  };

  const glowColors = {
    gold: "rgba(251, 191, 36, 0.5)",
    platinum: "rgba(226, 232, 240, 0.5)",
    purple: "rgba(167, 139, 250, 0.5)",
    blue: "rgba(56, 189, 248, 0.5)",
    green: "rgba(74, 222, 128, 0.5)",
    red: "rgba(248, 113, 113, 0.5)",
  };
</script>

<div class="dev-container">
  <header class="hero">
    <span class="badge">{t('credits.badge', locale)}</span>
    <h1>{t('credits.heading', locale)}</h1>
    <p>{t('credits.subtitle', locale)}</p>
  </header>

  <div class="grid">
    {#each teamMembers as member}
      <div
        class="card"
        style:--border-gradient={colors[member.color] || colors.blue}
        style:--glow-color={glowColors[member.color] || glowColors.blue}
      >
        <div class="card-content">
          <div class="avatar-wrapper">
            {#if member.avatar}
              <img src={textureUrl(member.avatar)} alt={member.name} class="avatar" />
            {:else}
              <div class="avatar-placeholder">{member.name[0]}</div>
            {/if}
            <div class="rank-badge" style:background={colors[member.color] || colors.blue}></div>
          </div>

          <div class="info">
            <div class="role">{member.role}</div>
            <h3 class="name">{member.name}</h3>
            {#if member.desc}
              <p class="desc">{member.desc}</p>
            {/if}
          </div>

          {#if member.socials.length > 0}
            <div class="socials">
              {#each member.socials as link}
                <a href={link.url} target="_blank" rel="noopener noreferrer" class="social-link">
                  {link.name} ↗
                </a>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .dev-container {
    max-width: 1000px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  /* --- HERO --- */
  .hero {
    text-align: center;
    margin-bottom: 4rem;
  }

  .badge {
    display: inline-block;
    padding: 0.4rem 1rem;
    border-radius: 99px;
    background: rgba(59, 130, 246, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.4);
    color: #60a5fa;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 1rem;
    font-weight: 600;
    font-family: "TT Supermolot Neue", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans";
  }

  h1 {
    font-size: clamp(2.5rem, 5vw, 4rem);
    margin: 0 0 1rem;
    background: linear-gradient(to right, #fff, #94a3b8);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    font-weight: 800;
    font-family: "TT Supermolot Neue", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans";
  }

  p {
    color: #e2e8f0;
    font-size: 1.1rem;
    max-width: 600px;
    margin: 0 auto;
    font-weight: 500;
    font-family: "TT Supermolot Neue", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans";
  }

  /* --- GRID --- */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 2rem;
    justify-items: center; /* Центрируем элементы сетки */
  }

  @media (max-width: 768px) {
    .grid {
      gap: 1.5rem; /* Уменьшаем отступ между карточками на мобилках */
      grid-template-columns: 1fr; /* Одна колонка на мобилках */
    }

    .card {
      max-width: 320px; /* Ограничиваем максимальную ширину карточки на мобилках */
      width: 100%;
    }

    .dev-container {
      padding: 1rem 0.5rem;
    }
  }

  /* --- CARD --- */
  .card {
    position: relative;
    background: rgba(30, 41, 59, 0.4);
    border-radius: var(--radius-xl);
    padding: 2px; /* Space for gradient border */
    transition: transform 0.3s ease, box-shadow 0.3s ease;
  }

  .card::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: var(--radius-xl);
    padding: 2px;
    background: var(--border-gradient);
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: 0.5;
    pointer-events: none;
  }

  .card:hover {
    transform: translateY(-5px);
    box-shadow: 0 20px 40px -10px var(--glow-color);
  }

  .card:hover::before {
    opacity: 1;
  }

  .card-content {
    background: #1e293b;
    border-radius: var(--radius-xl);
    padding: 2rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    position: relative;
    overflow: hidden;
  }

  /* --- AVATAR --- */
  .avatar-wrapper {
    position: relative;
    margin-bottom: 1.5rem;
  }

  .avatar, .avatar-placeholder {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    object-fit: cover;
    border: 4px solid #0f172a;
    box-shadow: 0 0 0 2px rgba(255,255,255,0.1);
  }

  .avatar-placeholder {
    background: #334155;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2.5rem;
    font-weight: 700;
    color: #94a3b8;
    font-family: "TT Supermolot Neue", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans";
  }

  .rank-badge {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 3px solid #1e293b;
    box-shadow: 0 2px 5px rgba(0,0,0,0.5);
  }

  /* --- INFO --- */
  .role {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #94a3b8;
    margin-bottom: 0.5rem;
    font-weight: 700;
    font-family: "TT Supermolot Neue", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans";
  }

  .name {
    margin: 0 0 0.75rem;
    font-size: 1.5rem;
    color: #fff;
    font-family: "TT Supermolot Neue", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans";
  }

  .desc {
    font-size: 0.9rem;
    color: #cbd5f5;
    line-height: 1.5;
    margin: 0 0 1.5rem;
    font-family: "TT Supermolot Neue", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans";
  }

  /* --- SOCIALS --- */
  .socials {
    margin-top: auto;
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .social-link {
    font-size: 0.8rem;
    color: #fff;
    background: rgba(255,255,255,0.05);
    padding: 0.5rem 1rem;
    border-radius: 8px;
    text-decoration: none;
    transition: background 0.2s;
    border: 1px solid rgba(255,255,255,0.05);
    font-family: "TT Supermolot Neue", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans";
  }

  .social-link:hover {
    background: rgba(255,255,255,0.15);
  }
</style>
