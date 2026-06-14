import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/components/FileExplorer.vue'),
    },
    {
      path: '/article/:id',
      name: 'article',
      component: () => import('@/views/ArticlePage.vue'),
    },
    {
      path: '/review/:id',
      name: 'review',
      component: () => import('@/views/ReviewPage.vue'),
    },
  ],
})

export default router
