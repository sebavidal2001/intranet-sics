"use client";

import { LazyMotion, domAnimation, m } from "framer-motion";
import { ExternalLink, Newspaper } from "lucide-react";

interface Block {
  id: string;
  tipo: string;
  titolo: string;
  testo: string | null;
  url: string | null;
  icona: string | null;
  ordine: number;
}

export function HomepageBlocks({
  news,
  links,
}: {
  news: Block[];
  links: Block[];
}) {
  return (
    <LazyMotion features={domAnimation}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* News */}
        {news.length > 0 && (
          <section>
            <h2 className="font-tenorite text-xl text-text mb-4 flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-primary" />
              Notizie
            </h2>
            <div className="space-y-3">
              {news.map((item, i) => (
                <m.article
                  key={item.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.08 }}
                  className="bg-bg rounded-xl border border-border p-4"
                >
                  <h3 className="font-tenorite text-sm text-text mb-1">
                    {item.titolo}
                  </h3>
                  {item.testo && (
                    <p className="text-sm text-text-muted leading-relaxed">
                      {item.testo}
                    </p>
                  )}
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary-dark mt-2 transition-colors"
                    >
                      Leggi di più <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </m.article>
              ))}
            </div>
          </section>
        )}

        {/* Link rapidi */}
        {links.length > 0 && (
          <section>
            <h2 className="font-tenorite text-xl text-text mb-4 flex items-center gap-2">
              <ExternalLink className="w-5 h-5 text-primary" />
              Link rapidi
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {links.map((item, i) => (
                <m.a
                  key={item.id}
                  href={item.url ?? "#"}
                  target={item.url?.startsWith("http") ? "_blank" : "_self"}
                  rel="noopener noreferrer"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.07 }}
                  className="flex items-center gap-3 p-3.5 bg-bg rounded-xl border border-border hover:shadow-card hover:-translate-y-0.5 transition-[transform,box-shadow] duration-150 group"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
                    <ExternalLink className="w-4 h-4 text-primary" />
                  </div>
                  <span className="font-tenorite text-sm text-text group-hover:text-primary transition-colors">
                    {item.titolo}
                  </span>
                </m.a>
              ))}
            </div>
          </section>
        )}
      </div>
    </LazyMotion>
  );
}
