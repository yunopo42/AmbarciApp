import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/** Klavye açık mı. Klavye açıkken ekranın altındaki güvenli alan boşluğu gerekmez (klavye o alanı kaplar). */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}
