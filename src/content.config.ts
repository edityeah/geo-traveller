import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({
    pattern: '**/*.{md,mdx}',
    base: './src/content/posts',
  }),
  schema: z.object({
    title: z.string(),
    slug: z.string().optional(),
    publishDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    locationName: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    cover: z.string().optional(),
    excerpt: z.string().optional(),
    originalUrl: z.string().optional(),
    originalDate: z.coerce.date().optional(),
    draft: z.boolean().default(false),
  }),
});

const pages = defineCollection({
  loader: glob({
    pattern: '**/*.{md,mdx}',
    base: './src/content/pages',
  }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    description: z.string().optional(),
    showInFooter: z.boolean().default(false),
    // Author headshot, mirrored to R2 from the Notion "Author Photo" property.
    authorPhoto: z.string().optional(),
  }),
});

export const collections = { posts, pages };
