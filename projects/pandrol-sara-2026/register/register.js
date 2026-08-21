(() => {
  "use strict";

  const FORM_ENDPOINT = "https://prod-eu-west-1-2.clickup.com/ui/v3/workspaces/9005033045/forms/8cbvtjn-18772/submit?token=BWBAH4JYH9D82XWGOG&ngsw-bypass=true";
  const HOME_URL = "./";
  const RETURN_DELAY_MS = 3500;
  const startedAt = Date.now();

  const fieldIds = {
    firstName: "6c89ace3-8193-47e9-93ed-8a0e8019121f",
    surname: "5e0ec64f-9633-4b35-8555-aee9a4067de4",
    company: "afae7d08-3fb6-416c-adec-76122ae16a27",
    jobTitle: "2ea6599b-d158-4f04-9d6d-b1020b282082",
    telephone: "37664947-0f59-4903-8635-2e4858fbac4c",
    email: "5127d0fb-6bda-46f2-9bfa-969fdb430f76",
    services: "ef6207e2-bbe9-49c0-99ba-8202c30e5271",
    challenge: "09ec71ae-8f05-4d41-9a8f-b7ff72ecb51d",
    contactMethod: "b9eceb62-8eb1-4018-bede-2110dab15b85",
    consent: "87fb70ce-0ec9-4d1d-b0a7-ea94f8d0abaa"
  };

  const form = document.querySelector("#visitor-form");
  const status = document.querySelector("#form-status");
  const servicesError = document.querySelector("#services-error");
  const contactMethodError = document.querySelector("#contact-method-error");
  const phoneInput = document.querySelector("#telephone");
  const phoneError = document.querySelector("#telephone-error");
  const successPanel = document.querySelector("#success-panel");
  const submitButton = form.querySelector(".submit-button");
  const submitLabel = submitButton.querySelector("span");
  const newEntryButton = document.querySelector("#new-entry");

  let phoneInputInstance = null;

  const phoneReady = (() => {
    if (!window.intlTelInput) {
      phoneInput.setCustomValidity("The international country selector could not load.");
      phoneError.textContent =
        "The country selector could not load. Please check the connection and refresh the page.";

      return Promise.resolve();
    }

    phoneInputInstance = window.intlTelInput(phoneInput, {
      initialCountry: "za",
      countryOrder: ["za", "gb", "fr"],
      countrySearch: true,
      countrySelectorMode: "FULLSCREEN",
      separateDialCode: true,
      strictMode: true,
      placeholderNumberPolicy: "AGGRESSIVE",
      allowedNumberTypes: ["MOBILE", "FIXED_LINE"],
      loadUtils: () =>
        import("https://cdn.jsdelivr.net/npm/intl-tel-input@29.2.3/dist/js/utils.js")
    });

    return phoneInputInstance.promise.catch(() => {
      phoneInput.setCustomValidity(
        "The international phone validation service could not load."
      );

      phoneError.textContent =
        "Phone validation could not load. Please check the connection and refresh the page.";
    });
  })();

  const getInternationalPhone = () =>
    phoneInputInstance?.getNumber() || "";

  const customField = (id, value) => ({
    id,
    value
  });

  const validate = () => {
    phoneInput.setCustomValidity("");
    phoneError.textContent = "";
    contactMethodError.textContent = "";

    if (!phoneInput.value.trim()) {
      phoneInput.setCustomValidity(
        "Please enter a telephone or WhatsApp number."
      );

      phoneError.textContent =
        "Please enter a telephone or WhatsApp number.";
    } else if (!phoneInputInstance?.isValidNumber()) {
      phoneInput.setCustomValidity(
        "Please enter a valid number for the selected country."
      );

      phoneError.textContent =
        "Please enter a valid number for the selected country.";
    }

    let valid = form.checkValidity();

    const services = form.querySelectorAll(
      'input[name="services"]:checked'
    );

    const contactMethods = form.querySelectorAll(
      'input[name="contactMethod"]:checked'
    );

    form.querySelectorAll("input, textarea").forEach((control) => {
      control.setAttribute(
        "aria-invalid",
        control.validity.valid ? "false" : "true"
      );
    });

    if (!services.length) {
      servicesError.textContent =
        "Please select at least one service of interest.";

      valid = false;
    } else {
      servicesError.textContent = "";
    }

    if (!contactMethods.length) {
      contactMethodError.textContent =
        "Please select at least one preferred contact method.";

      valid = false;
    } else {
      contactMethodError.textContent = "";
    }

    if (!valid) {
      const firstInvalid = form.querySelector(
        '[aria-invalid="true"]'
      );

      if (firstInvalid) {
        firstInvalid.focus();
      } else if (!contactMethods.length) {
        form.querySelector(
          'input[name="contactMethod"]'
        )?.focus();
      }
    }

    return valid;
  };

  const buildPayload = () => {
    const data = new FormData(form);

    return {
      customFields: [
        customField(
          fieldIds.firstName,
          data.get("firstName").trim()
        ),

        customField(
          fieldIds.surname,
          data.get("surname").trim()
        ),

        customField(
          fieldIds.company,
          data.get("company").trim()
        ),

        customField(
          fieldIds.jobTitle,
          data.get("jobTitle").trim()
        ),

        customField(
          fieldIds.telephone,
          getInternationalPhone()
        ),

        customField(
          fieldIds.email,
          data.get("email").trim()
        ),

        customField(
          fieldIds.services,
          data.getAll("services")
        ),

        customField(
          fieldIds.challenge,
          data.get("challenge").trim()
        ),

        customField(
          fieldIds.contactMethod,
          data.getAll("contactMethod")
        ),

        customField(
          fieldIds.consent,
          data.get("consent") === "on"
        )
      ],

      timezone: "Africa/Johannesburg",
      assignees: [],
      group_assignees: []
    };
  };

  const showSuccess = () => {
    form.hidden = true;
    successPanel.hidden = false;
    successPanel.focus();

    successPanel.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });

    window.setTimeout(() => {
      window.location.replace(HOME_URL);
    }, RETURN_DELAY_MS);
  };

  form.addEventListener("input", (event) => {
    if (event.target.matches("input, textarea")) {
      event.target.setAttribute(
        "aria-invalid",
        event.target.validity.valid ? "false" : "true"
      );
    }

    if (event.target.name === "services") {
      servicesError.textContent = "";
    }

    if (event.target.name === "contactMethod") {
      contactMethodError.textContent = "";
    }

    if (event.target.name === "telephone") {
      phoneInput.setCustomValidity("");
      phoneError.textContent = "";
    }

    status.textContent = "";
  });

  phoneInput.addEventListener("countrychange", () => {
    phoneInput.setCustomValidity("");
    phoneError.textContent = "";
    status.textContent = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    status.textContent = "";

    await phoneReady;

    if (!validate()) {
      return;
    }

    if (
      form.elements.website.value ||
      Date.now() - startedAt < 1800
    ) {
      showSuccess();
      return;
    }

    submitButton.disabled = true;
    submitLabel.textContent = "Submitting…";

    const requestBody = new FormData();

    requestBody.append(
      "body",
      JSON.stringify(buildPayload())
    );

    try {
      await fetch(FORM_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        credentials: "omit",
        body: requestBody
      });

      showSuccess();
    } catch (error) {
      status.textContent =
        "We couldn’t submit your details. Please check the connection and try again.";
    } finally {
      submitButton.disabled = false;
      submitLabel.textContent = "Submit details";
    }
  });

  newEntryButton.addEventListener("click", () => {
    window.location.replace(HOME_URL);
  });
})();
