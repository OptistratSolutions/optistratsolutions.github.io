(() => {
  "use strict";

  const FORM_ENDPOINT =
    "https://prod-eu-west-1-2.clickup.com/ui/v3/workspaces/9005033045/forms/8cbvtjn-18752/submit?token=3LKGNJRJUHH1JIBOLT&ngsw-bypass=true";

  const fieldIds = {
    contactName: "137bc364-bb78-426a-8f00-b96106002554",
    company: "b555e11e-ccdc-41d8-b935-16db84a53902",
    email: "1fd9314f-ed44-4d75-9d88-a3e2120daed9",
    phone: "d32f9074-f147-4067-b711-a9dbe2f4ef66",
    services: "413ae7eb-5a35-467a-875b-8b0b260e80b2",
    budget: "23880d3c-e0ff-4fa1-aebe-e02e7457851f"
  };

  const form = document.querySelector("#project-enquiry-form");

  if (!form) {
    return;
  }

  const status = document.querySelector("#enquiry-form-status");
  const servicesFieldset = form.querySelector(".enquiry-fieldset");
  const servicesError = document.querySelector("#services-error");
  const phoneInput = document.querySelector("#phone");
  const dateInput = document.querySelector("#completion-date");
  const submitButton = form.querySelector(".enquiry-submit");
  const submitLabel = submitButton.querySelector("[data-submit-label]");
  const successPanel = document.querySelector("#enquiry-success");
  const newEnquiryButton = document.querySelector("#send-another-enquiry");

  let isSubmitting = false;

  const toLocalDateValue = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  dateInput.min = toLocalDateValue(new Date());

  const customField = (id, value) => ({ id, value });

  const selectedServices = () =>
    Array.from(form.querySelectorAll('input[name="services"]:checked'));

  const validate = () => {
    phoneInput.setCustomValidity("");
    servicesError.textContent = "";
    servicesFieldset.removeAttribute("aria-invalid");
    status.textContent = "";

    const phoneDigits = phoneInput.value.replace(/\D/g, "");

    if (phoneInput.value.trim() && (phoneDigits.length < 9 || phoneDigits.length > 15)) {
      phoneInput.setCustomValidity("Please enter a valid contact number.");
    }

    let valid = form.checkValidity();
    const services = selectedServices();

    form.querySelectorAll("input, select, textarea").forEach((control) => {
      if (control.name !== "services" && control.name !== "website") {
        control.setAttribute("aria-invalid", control.validity.valid ? "false" : "true");
      }
    });

    if (!services.length) {
      servicesFieldset.setAttribute("aria-invalid", "true");
      servicesError.textContent = "Please select at least one type of support.";
      valid = false;
    }

    if (!valid) {
      status.textContent = "Please complete the highlighted required information.";

      const firstInvalid = form.querySelector('[aria-invalid="true"]');

      if (firstInvalid && firstInvalid !== servicesFieldset) {
        firstInvalid.focus();
      } else if (!services.length) {
        form.querySelector('input[name="services"]')?.focus();
      }
    }

    return valid;
  };

  const buildPayload = () => {
    const data = new FormData(form);
    const services = selectedServices();
    const serviceIds = services.map((control) => control.value);
    const serviceNames = services.map((control) => control.dataset.label);
    const budgetSelect = form.elements.budget;
    const budgetValue = String(data.get("budget") || "");
    const budgetLabel = budgetValue
      ? budgetSelect.selectedOptions[0]?.textContent.trim()
      : "Not provided";
    const completionDate = String(data.get("completionDate") || "");
    const details = String(data.get("details") || "").trim();

    const summary = [
      details,
      "",
      "Website enquiry summary",
      `Services selected: ${serviceNames.join(", ")}`,
      `Indicative budget: ${budgetLabel}`,
      `Preferred completion date: ${completionDate || "Not provided"}`
    ].join("\n");

    const customFields = [
      customField(fieldIds.contactName, String(data.get("contactName") || "").trim()),
      customField(fieldIds.company, String(data.get("company") || "").trim()),
      customField(fieldIds.email, String(data.get("email") || "").trim()),
      customField(fieldIds.phone, String(data.get("phone") || "").trim()),
      customField(fieldIds.services, serviceIds)
    ];

    if (budgetValue) {
      customFields.push(customField(fieldIds.budget, budgetValue));
    }

    const payload = {
      name: String(data.get("projectTitle") || "").trim(),
      content: summary,
      customFields,
      timezone: "Africa/Johannesburg",
      assignees: [],
      group_assignees: []
    };

    if (completionDate) {
      payload.due_date = String(
        new Date(`${completionDate}T12:00:00+02:00`).getTime()
      );
    }

    return payload;
  };

  const showSuccess = () => {
    form.hidden = true;
    successPanel.hidden = false;
    successPanel.focus();
    successPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  form.addEventListener("input", (event) => {
    const control = event.target;

    if (control.matches("input, select, textarea") && control.name !== "website") {
      control.removeAttribute("aria-invalid");
      control.setCustomValidity("");
    }

    if (control.name === "services") {
      servicesError.textContent = "";
      servicesFieldset.removeAttribute("aria-invalid");
    }

    status.textContent = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isSubmitting || !validate()) {
      return;
    }

    if (form.elements.website.value) {
      return;
    }

    isSubmitting = true;
    submitButton.disabled = true;
    submitLabel.textContent = "Sending…";

    const requestBody = new FormData();
    requestBody.append("body", JSON.stringify(buildPayload()));

    try {
      await fetch(FORM_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        credentials: "omit",
        body: requestBody
      });

      showSuccess();
    } catch (error) {
      console.error("OptiStrat Solutions enquiry submission failed:", error);
      status.textContent =
        "We could not submit your enquiry. Please check your connection and try again, or contact us by phone or WhatsApp.";
    } finally {
      isSubmitting = false;
      submitButton.disabled = false;
      submitLabel.textContent = "Send Project Enquiry";
    }
  });

  newEnquiryButton.addEventListener("click", () => {
    form.reset();
    form.querySelectorAll("[aria-invalid]").forEach((control) => {
      control.removeAttribute("aria-invalid");
    });
    servicesError.textContent = "";
    status.textContent = "";
    successPanel.hidden = true;
    form.hidden = false;
    form.querySelector("input")?.focus();
  });
})();
