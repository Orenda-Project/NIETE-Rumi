import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Globe } from 'lucide-react';
// Aliased: `language` is already the loop variable in languages.map() below,
// and a shadowed import here would be a genuine trap for the next reader.
import { language as languageApi } from '@/portal/services/api';

// The deployment's offer, Urdu first — mirroring bot/shared/config/languages.js.
// This array was its own fourth language list, disagreeing with the bot, the i18n
// config and the reading-assessment filter. Spanish and Arabic had no content
// behind them on any surface.
const languages = [
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { code: 'en', name: 'English', nativeName: 'English' },
];

const LanguageSwitcher = () => {
  const { i18n } = useTranslation();

  // Persist FIRST, then re-render.
  //
  // This used to call i18n.changeLanguage() and nothing else — a device-local
  // cosmetic, so switching here never reached the bot and her next WhatsApp reply
  // came back in the old language. The write goes through the portal API, which
  // goes through the bot's single language writer (lock set, caches invalidated).
  //
  // Order matters: if the write fails we must NOT re-render, or the portal would
  // show a language the bot does not know about — the same disagreement this
  // whole change removes, just pointing the other way.
  const changeLanguage = async (lng: string) => {
    if (lng === i18n.language) return;
    try {
      await languageApi.set(lng);
      i18n.changeLanguage(lng);
    } catch {
      // Left on the current language on purpose. Better to look like the tap did
      // not register than to show a language the bot is not using.
    }
  };

  const currentLanguage = languages.find(lang => lang.code === i18n.language) || languages[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Globe className="h-4 w-4" />
          <span className="hidden sm:inline">{currentLanguage.nativeName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languages.map((language) => (
          <DropdownMenuItem
            key={language.code}
            onClick={() => changeLanguage(language.code)}
            className={i18n.language === language.code ? 'bg-accent' : ''}
          >
            {language.nativeName}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default LanguageSwitcher;
