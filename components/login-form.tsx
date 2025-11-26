'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, error } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    await login(email, password);
  };

  return (
    <div className="w-full max-w-md">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Logga in</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Använd ditt Directus-konto för att logga in
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-2 text-gray-900 dark:text-gray-200">
            E-postadress
          </label>
          <input
            id="email"
            type="email"
            placeholder="namn@falkenberg.se"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-[#1f4e99] dark:focus:ring-[#86cedf] focus:border-transparent outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-2 text-gray-900 dark:text-gray-200">
            Lösenord
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-[#1f4e99] dark:focus:ring-[#86cedf] focus:border-transparent outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
        </div>

        {error && (
          <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full px-4 py-2 bg-[#1f4e99] text-white font-medium rounded-lg hover:bg-[#163a73] dark:bg-[#86cedf] dark:text-gray-900 dark:hover:bg-[#6db8cc] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? 'Loggar in...' : 'Logga in'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Kontakta din administratör om du har problem med att logga in
        </p>
      </div>
    </div>
  );
}
