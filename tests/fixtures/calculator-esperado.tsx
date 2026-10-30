import React, { useState, KeyboardEvent } from 'react';

type Operation = '+' | '-' | '*' | '/';

export const AccessibleCalculator = () => {
  const [display, setDisplay] = useState<string>('0');
  return <div role="application" aria-label="Calculadora">{display}</div>;
};
