(() => {
  "use strict";
  const data = window.sendbGuide;
  const el = id => document.getElementById(id);
  let taskIndex = 0, stepIndex = 0, business = "designer", dialogTrigger;
  const make = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const set = (id, text) => { el(id).textContent = text; };
  function openImage(id, trigger) {
    const shot = data.images[id]; dialogTrigger = trigger;
    set("dialog-title", shot.title);
    el("dialog-image").src = shot.file; el("dialog-image").alt = shot.alt;
    set("dialog-caption", shot.caption + " " + shot.scope);
    el("image-dialog").showModal(); el("close-dialog").focus();
  }
  function chooseTask(index, focus) {
    taskIndex = index; stepIndex = 0; render();
    if (focus) el("task-title").focus({preventScroll:true});
  }
  function render() {
    const task = data.tasks[taskIndex], step = task.steps[stepIndex];
    set("business-context", data.businesses[business].context);
    el("tasks").replaceChildren(...data.tasks.map((item, index) => {
      const b = make("button", undefined, "task-button"); b.type = "button";
      b.setAttribute("aria-current", index === taskIndex ? "page" : "false");
      b.append(make("span", String(index + 1).padStart(2, "0"), "num"));
      const text = make("span"); text.append(make("strong", item.nav), make("small", item.navSub)); b.append(text);
      b.addEventListener("click", () => chooseTask(index, true)); return b;
    }));
    set("task-counter", `TASK ${String(taskIndex + 1).padStart(2, "0")} / 06`);
    set("task-title", task.title); set("task-summary", task.summary);
    set("task-role", task.role); set("task-example", `가상 예시 · ${task.examples[business]}`);
    el("steps").replaceChildren(...task.steps.map((s, index) => {
      const b = make("button", undefined, "step-button"); b.type = "button";
      b.setAttribute("aria-current", index === stepIndex ? "step" : "false");
      b.append(make("span", index + 1, "step-num"), make("span", s.short));
      b.addEventListener("click", () => { stepIndex = index; render(); el("step-title").focus({preventScroll:true}); }); return b;
    }));
    set("step-location", step.location); set("step-counter", `STEP ${String(stepIndex + 1).padStart(2, "0")}`);
    set("step-title", step.title); set("step-description", step.description);
    el("actions").replaceChildren(...step.actions.map(text => make("li", text)));
    set("completion", step.completion); set("attention", step.attention || "");
    el("attention-wrap").hidden = !step.attention;
    set("recovery", step.recovery || ""); el("recovery-wrap").hidden = !step.recovery; el("recovery-wrap").open = false;
    el("previous").disabled = stepIndex === 0; el("next").disabled = stepIndex === task.steps.length - 1;
    set("position", `${stepIndex + 1} / ${task.steps.length} 단계`);
    el("capture").hidden = !task.image;
    if (task.image) {
      const shot = data.images[task.image]; set("capture-title", shot.title);
      el("capture-image").src = shot.file; el("capture-image").alt = shot.alt;
      set("capture-caption", shot.caption); set("capture-scope", shot.scope);
    }
    el("customer-view").hidden = taskIndex !== 0;
    el("customer-view").open = false;
    el("next-task").hidden = taskIndex === data.tasks.length - 1;
    if (taskIndex < data.tasks.length - 1) set("next-task-button", `${String(taskIndex + 2).padStart(2,"0")} · ${data.tasks[taskIndex + 1].title} →`);
  }
  el("business").addEventListener("change", e => { business = e.target.value; render(); });
  el("previous").addEventListener("click", () => { if (stepIndex > 0) { stepIndex--; render(); } });
  el("next").addEventListener("click", () => { if (stepIndex < data.tasks[taskIndex].steps.length - 1) { stepIndex++; render(); } });
  el("next-task-button").addEventListener("click", () => { if (taskIndex < data.tasks.length - 1) chooseTask(taskIndex + 1, true); });
  el("enlarge").addEventListener("click", e => openImage(data.tasks[taskIndex].image, e.currentTarget));
  el("close-dialog").addEventListener("click", () => el("image-dialog").close());
  el("image-dialog").addEventListener("close", () => dialogTrigger?.focus());
  el("customer-images").replaceChildren(...["customerList","customerFiles"].map(id => {
    const shot = data.images[id], figure = make("figure"), img = make("img"), caption = make("figcaption", shot.caption), b = make("button", "화면 크게 보기 ↗");
    img.src = shot.file; img.alt = shot.alt; img.loading = "lazy"; b.type = "button";
    b.addEventListener("click", e => openImage(id, e.currentTarget));
    figure.append(img, caption, b); return figure;
  }));
  render();
})();
