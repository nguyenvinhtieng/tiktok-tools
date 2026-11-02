import vocabulary from './quiz-vocabulary.json' with { type: 'json' };

// User-supplied bilingual PDF. Levels are editorial quiz estimates, not Oxford CEFR labels.
// Original page/topic retained; sourceAnswer/sourceVi/sourcePos record corrected source errors.
export const SOURCES = [{
  name:'3000 từ vựng tiếng Anh thông dụng theo chủ đề · PDF nguồn',
  url:'/quiz-vocabulary.pdf'
}];
export const VOCABULARY = {sourceRows:1760,uniqueWords:vocabulary.length,levelSource:'estimated'};
export const WORDS = vocabulary;
