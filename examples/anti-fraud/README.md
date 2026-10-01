# 反诈攻防对抗课

这门课由 `npm run new:lesson` 生成。启动：在工作台顶栏"当前课程"下拉框里选《反诈攻防对抗课》（或 `.env` 写 `LESSON_CONFIG=./lessons/anti-fraud/lesson.config.js`），然后到第 5 步"启动上课"点"启动平台"。
加阶段：`npm run new:stage -- --lesson ./lessons/anti-fraud/lesson.config.js --id <id> --label <阶段名> --primitive <vote|quiz|free-text|code|data-analysis|none>`，
会在 `lessons/anti-fraud/stages/` 下生成 `NN-<id>/`（阶段卡 STAGE.md + 配置或骨架）并追加进 `lesson.config.js` 的 `stages`；
按阶段卡把 `TODO：` 占位填完，再跑 `npm run check:lesson`，直到只剩"通过"。
