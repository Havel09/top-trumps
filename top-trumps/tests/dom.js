'use strict';
/**
 * dom.js - Un DOM minimal, juste ce que le jeu utilise.
 *
 * Le but n'est pas d'être un navigateur : c'est de fournir au code client
 * les quelques méthodes dont il a besoin pour se construire, afin que
 * tests/interface.test.js puisse faire tourner la vraie page de jeu hors
 * navigateur. Un élément connaît ses enfants, son texte, ses classes et
 * ses écouteurs ; c'est tout.
 */

class Classe {
  constructor(element) {
    this.element = element;
    this.valeurs = new Set();
  }
  add(...noms) {
    for (const nom of noms) if (nom) this.valeurs.add(nom);
  }
  remove(...noms) {
    for (const nom of noms) this.valeurs.delete(nom);
  }
  toggle(nom, force) {
    if (force === undefined) {
      if (this.valeurs.has(nom)) this.valeurs.delete(nom);
      else this.valeurs.add(nom);
    } else if (force) {
      this.valeurs.add(nom);
    } else {
      this.valeurs.delete(nom);
    }
  }
  contains(nom) {
    return this.valeurs.has(nom);
  }
  toString() {
    return [...this.valeurs].join(' ');
  }
}

class Element {
  constructor(tag, document) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.parent = null;
    this.attributs = new Map();
    this.dataset = {};
    this.style = {};
    this._text = '';
    this.classList = new Classe(this);
    this.ecouteurs = new Map();
    this.hidden = false;
    this.value = '';
    this.disabled = false;
    this.checked = false;
  }

  // --- contenu ----------------------------------------------------------
  append(...noeuds) {
    for (const noeud of noeuds) {
      if (noeud === null || noeud === undefined) continue;
      const el = typeof noeud === 'string' ? this.ownerDocument.createTextNode(noeud) : noeud;
      el.parent = this;
      this.children.push(el);
    }
  }
  appendChild(noeud) {
    this.append(noeud);
    return noeud;
  }
  /** Interface.vider() fonctionne en firstChild / removeChild(firstChild). */
  get firstChild() {
    return this.children.length > 0 ? this.children[0] : null;
  }
  get lastChild() {
    return this.children.length > 0 ? this.children[this.children.length - 1] : null;
  }
  get childNodes() {
    return this.children;
  }
  removeChild(noeud) {
    const i = this.children.indexOf(noeud);
    if (i >= 0) {
      this.children.splice(i, 1);
      noeud.parent = null;
    }
    return noeud;
  }
  remove() {
    if (this.parent) this.parent.removeChild(this);
  }
  replaceChildren(...noeuds) {
    this.children = [];
    this._text = '';
    this.append(...noeuds);
  }
  clear() {
    this.replaceChildren();
  }
  set textContent(valeur) {
    this._text = valeur === null || valeur === undefined ? '' : String(valeur);
    this.children = [];
  }
  get textContent() {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set innerHTML(valeur) {
    this._text = '';
    this.children = [];
    this.attributs.set('__html', valeur);
  }
  get innerHTML() {
    return this.textContent;
  }

  // --- attributs --------------------------------------------------------
  setAttribute(nom, valeur) {
    this.attributs.set(nom, String(valeur));
    if (nom === 'class') {
      this.classList = new Classe(this);
      this.classList.add(...String(valeur).split(/\s+/).filter(Boolean));
    }
    if (nom.startsWith('data-')) {
      const cle = nom
        .slice(5)
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[cle] = String(valeur);
    }
    if (nom === 'hidden') this.hidden = true;
  }
  getAttribute(nom) {
    return this.attributs.has(nom) ? this.attributs.get(nom) : null;
  }
  removeAttribute(nom) {
    this.attributs.delete(nom);
  }
  hasAttribute(nom) {
    return this.attributs.has(nom);
  }
  get className() {
    return this.classList.toString();
  }
  set className(valeur) {
    this.classList = new Classe(this);
    this.classList.add(...String(valeur).split(/\s+/).filter(Boolean));
  }

  // --- écouteurs --------------------------------------------------------
  addEventListener(type, fn) {
    if (!this.ecouteurs.has(type)) this.ecouteurs.set(type, []);
    this.ecouteurs.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const liste = this.ecouteurs.get(type);
    if (!liste) return;
    const i = liste.indexOf(fn);
    if (i >= 0) liste.splice(i, 1);
  }
  /** Simule un clic : c'est ainsi que le test joue vraiment la partie. */
  cliquer() {
    for (const fn of this.ecouteurs.get('click') || []) {
      fn({ target: this, preventDefault() {}, key: '' });
    }
  }
  soumettre() {
    for (const fn of this.ecouteurs.get('submit') || []) {
      fn({ preventDefault() {}, target: this });
    }
  }
  /** Simule une touche (Entree ou Espace sur un element jouable). */
  touche(cle) {
    for (const fn of this.ecouteurs.get('keydown') || []) {
      fn({ target: this, preventDefault() {}, key: cle });
    }
  }
  dispatch(type) {
    for (const fn of this.ecouteurs.get(type) || []) {
      fn({ target: this, preventDefault() {}, key: '' });
    }
  }

  // --- recherche --------------------------------------------------------
  descendants() {
    const sortie = [];
    const visiter = (el) => {
      for (const enfant of el.children) {
        if (enfant instanceof Element) {
          sortie.push(enfant);
          visiter(enfant);
        }
      }
    };
    visiter(this);
    return sortie;
  }
  querySelectorAll(selecteur) {
    return this.descendants().filter((el) => el.correspond(selecteur));
  }
  querySelector(selecteur) {
    return this.querySelectorAll(selecteur)[0] || null;
  }
  correspond(selecteur) {
    return selecteur
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .some((s) => {
        if (s === '*') return true;
        if (s.startsWith('#')) return this.attributs.get('id') === s.slice(1);
        if (s.startsWith('.')) return this.classList.contains(s.slice(1));
        if (s.startsWith('[') && s.endsWith(']')) {
          const nom = s.slice(1, -1).split('=')[0];
          return this.attributs.has(nom);
        }
        return this.tagName === s.toUpperCase();
      });
  }
  closest(selecteur) {
    let el = this;
    while (el) {
      if (el instanceof Element && el.correspond(selecteur)) return el;
      el = el.parent;
    }
    return null;
  }
  focus() {}
  blur() {}
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 };
  }
}

class Texte {
  constructor(valeur) {
    this._text = String(valeur);
    this.parent = null;
  }
  get textContent() {
    return this._text;
  }
  set textContent(valeur) {
    this._text = String(valeur);
  }
}

class Document {
  constructor() {
    this.parId = new Map();
    this.ecouteurs = new Map();
    this.body = new Element('body', this);
    this.body.setAttribute('id', 'body');
    this.parId.set('body', this.body);
  }
  createElement(tag) {
    return new Element(tag, this);
  }
  createTextNode(valeur) {
    return new Texte(valeur);
  }
  createDocumentFragment() {
    return new Element('fragment', this);
  }
  getElementById(id) {
    return this.parId.get(id) || null;
  }
  querySelector(selecteur) {
    return this.body.querySelector(selecteur);
  }
  querySelectorAll(selecteur) {
    return this.body.querySelectorAll(selecteur);
  }
  addEventListener(type, fn) {
    if (!this.ecouteurs.has(type)) this.ecouteurs.set(type, []);
    this.ecouteurs.get(type).push(fn);
  }
  removeEventListener() {}
  /** Declenche le chargement : les scripts utilisent DOMContentLoaded. */
  pret() {
    for (const fn of this.ecouteurs.get('DOMContentLoaded') || []) fn();
  }
  /** Enregistre un element pour que getElementById le retrouve. */
  inscrire(id, tag = 'div') {
    const el = new Element(tag, this);
    el.setAttribute('id', id);
    this.parId.set(id, el);
    this.body.append(el);
    return el;
  }
}

/** Stockage local minimal, pour les preferences du joueur. */
class Stockage {
  constructor() {
    this.donnees = new Map();
  }
  getItem(cle) {
    return this.donnees.has(cle) ? this.donnees.get(cle) : null;
  }
  setItem(cle, valeur) {
    this.donnees.set(cle, String(valeur));
  }
  removeItem(cle) {
    this.donnees.delete(cle);
  }
  clear() {
    this.donnees.clear();
  }
}

/**
 * Horloge virtuelle.
 *
 * La page de jeu enchaine ses etapes avec setTimeout (350 ms, 700 ms,
 * 2300 ms...). Attendre reellement ces delais ferait durer une partie
 * plusieurs minutes ; on remplace donc l'horloge par un compteur que le
 * test avance a la main.
 */
class Horloge {
  constructor() {
    this.maintenant = 0;
    this.minuteries = [];
    this.compteur = 0;
    this.erreurs = [];
    this.evenements = [];
  }

  setTimeout(fn, delai = 0) {
    const id = ++this.compteur;
    const ms = Number.isFinite(delai) && delai > 0 ? delai : 0;
    this.minuteries.push({ id, moment: this.maintenant + ms, fn });
    this.evenements.push({
      type: 'set',
      id,
      moment: this.maintenant + ms,
      delai: ms,
      reste: this.minuteries.length,
    });
    return id;
  }

  clearTimeout(id) {
    const i = this.minuteries.findIndex((m) => m.id === id);
    if (i >= 0) {
      this.minuteries.splice(i, 1);
      this.evenements.push({ type: 'clear', id, moment: this.maintenant, reste: this.minuteries.length });
    } else {
      this.evenements.push({ type: 'clear-absent', id, moment: this.maintenant });
    }
  }

  setInterval() {
    return 0; // le jeu n'utilise pas d'intervalle
  }
  clearInterval() {}

  get enAttente() {
    return this.minuteries.length;
  }

  /**
   * Avance l'horloge jusqu'a `cible`, en executant les minuteries au fur et
   * a mesure, et en laissant les promesses se resoudre entre deux d'entre
   * elles (c'est ainsi qu'une etape `await attendre(...)` s'enchaine).
   */
  async avancer(cible = this.maintenant) {
    for (;;) {
      await this.resoudre();

      let choisi = -1;
      for (let i = 0; i < this.minuteries.length; i += 1) {
        if (this.minuteries[i].moment <= cible) {
          if (choisi === -1 || this.minuteries[i].moment < this.minuteries[choisi].moment) {
            choisi = i;
          }
        }
      }
      if (choisi === -1) {
        this.maintenant = cible;
        await this.resoudre();
        return;
      }

      const minuterie = this.minuteries.splice(choisi, 1)[0];
      this.maintenant = Math.max(this.maintenant, minuterie.moment);
      this.evenements.push({
        type: 'fire',
        id: minuterie.id,
        moment: this.maintenant,
        message: this.surFire ? this.surFire() : '',
      });
      try {
        minuterie.fn();
      } catch (e) {
        this.erreurs.push(e);
        throw e;
      }
    }
  }

  /** Laisse les chaines de promesses se derouler. */
  async resoudre(tours = 24) {
    for (let i = 0; i < tours; i += 1) {
      await new Promise((r) => setImmediate(r));
    }
  }
}

module.exports = { Document, Element, Texte, Stockage, Horloge };
