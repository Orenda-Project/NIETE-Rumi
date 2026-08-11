import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import ur from './locales/ur.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ur: { translation: ur },
    },
    fallbackLng: 'en',
    // Urdu first, matching the bot's offer order (bot/shared/config/languages.js).
    // The portal used to carry four locales and its own supported list, so a
    // teacher could read this in Spanish while every message from Rumi arrived
    // in Urdu.
    supportedLngs: ['ur', 'en'],
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  });

// Function to apply language-specific styling
const applyLanguageStyle = (lng: string) => {
  const htmlElement = document.documentElement;
  
  // Set language attribute
  htmlElement.lang = lng;
  
  // Set direction
  htmlElement.dir = lng === 'ur' ? 'rtl' : 'ltr';
  
  // Apply language-specific font with !important to override all styles
  if (lng === 'ur') {
    htmlElement.style.cssText = 'font-family: "Noto Nastaliq Urdu", serif !important;';
  } else {
    htmlElement.style.cssText = 'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;';
  }
};

// Apply on language change
i18n.on('languageChanged', applyLanguageStyle);

// Apply immediately on initialization
i18n.on('initialized', () => {
  applyLanguageStyle(i18n.language);
});

export default i18n;
