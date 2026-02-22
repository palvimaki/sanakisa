// dictionary.js - Load and validate Finnish words

let dictionary = new Set();
let wordArray = [];

export async function loadDictionary() {
  try {
    const response = await fetch('words.txt');
    const text = await response.text();
    wordArray = text.split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length >= 2);
    dictionary = new Set(wordArray);
    console.log(`Dictionary loaded: ${dictionary.size} words`);
  } catch (err) {
    console.error('Failed to load dictionary:', err);
  }
}

export function isValidWord(word) {
  return dictionary.has(word.toLowerCase());
}

export function getWordList() {
  return wordArray;
}
