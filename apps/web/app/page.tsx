'use client';

import { useEffect } from 'react';

/**
 * Keep the downloaded V4 Marketplace HTML/CSS/JS as the page implementation.
 * Loading it as the document itself is required: its extracted Three.js module
 * owns a document-level fixed canvas and reads each [data-pose] section to drive
 * the exact scroll-controlled 3D block scene. Embedding in React would not run
 * the module scripts or reproduce that scene.
 */
export default function LandingPage() {
  useEffect(() => {
    window.location.replace('/templates/v4market/index.html');
  }, []);
  return null;
}
