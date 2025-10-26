document.addEventListener('DOMContentLoaded', function () {
    // A flag to ensure initialization only runs once
    let isInitialized = false;

    // --- Create a container for our popup elements ---
    const popupContainerElement = document.createElement('div');
    popupContainerElement.id = 'newsletter-popup-elements';
    document.body.appendChild(popupContainerElement);

    // --- Inject the newsletter button HTML ---
    const newsletterBtnHTML = `
        <div class="newsletter-btn" id="newsletterBtn">
            Sign up to our newsletter!
            <button class="close-btn" id="closeNewsletterBtn">×</button>
        </div>
    `;
    popupContainerElement.insertAdjacentHTML('beforeend', newsletterBtnHTML);

    // --- Fetch and inject the popup HTML ---
    fetch('/newsletter-popup.html') // Use root-relative path
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok for newsletter popup');
            }
            return response.text();
        })
        .then(html => {
            popupContainerElement.insertAdjacentHTML('beforeend', html);
            // Signal that popup content is ready
            document.dispatchEvent(new CustomEvent('newsletterPopupReady'));
        })
        .catch(error => console.error('Error loading newsletter popup:', error));

    // --- Main initialization logic ---
    function initializePopup() {
        if (isInitialized) return;
        
        const newsletterBtn = document.getElementById('newsletterBtn');
        const closeBtn = document.getElementById('closeNewsletterBtn');
        const newsletterPopupOverlay = document.getElementById('newsletter-popup-overlay');
        const closePopupBtn = document.getElementById('close-popup-btn');
        const popupContainer = document.querySelector('.newsletter-popup-container');

        if (!newsletterBtn || !closeBtn || !newsletterPopupOverlay || !closePopupBtn || !popupContainer) {
            // This can happen if the fetch fails, so we don't want errors cluttering the console.
            return;
        }
        
        isInitialized = true; // Mark as initialized

        // Show button after a delay
        setTimeout(function () {
            if (!localStorage.getItem('newsletterClosed')) {
                newsletterBtn.classList.add('visible');
                newsletterBtn.style.pointerEvents = 'none';
                newsletterBtn.addEventListener('transitionend', function () {
                    newsletterBtn.style.pointerEvents = 'auto';
                }, { once: true });
            }
        }, 3000);

        // Close button functionality
        closeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            newsletterBtn.classList.remove('visible');
            newsletterBtn.classList.add('hidden');
            localStorage.setItem('newsletterClosed', 'true');
        });

        let openTl, closeTl;

        function openPopup() {
            if (openTl && openTl.isActive()) return;

            const btnRect = newsletterBtn.getBoundingClientRect();
            const x = btnRect.left + btnRect.width / 2;
            const y = btnRect.top + btnRect.height / 2;
            const radius = Math.hypot(window.innerWidth, window.innerHeight);

            openTl = gsap.timeline();
            openTl.set(newsletterPopupOverlay, { className: 'active' })
                .fromTo(popupContainer,
                    { clipPath: `circle(0px at ${x}px ${y}px)` },
                    {
                        clipPath: `circle(${radius}px at ${x}px ${y}px)`,
                        duration: 0.75,
                        ease: "power2.inOut"
                    }
                )
                .add(() => { document.body.style.overflow = 'hidden'; }, 0);
        }

        function closePopup() {
            if (closeTl && closeTl.isActive()) return;

            const btnRect = newsletterBtn.getBoundingClientRect();
            const x = btnRect.left + btnRect.width / 2;
            const y = btnRect.top + btnRect.height / 2;

            closeTl = gsap.timeline({
                onComplete: () => {
                    gsap.set(newsletterPopupOverlay, { className: '' });
                    document.body.style.overflow = '';
                }
            });
            closeTl.to(popupContainer, {
                clipPath: `circle(0px at ${x}px ${y}px)`,
                duration: 0.6,
                ease: "power2.inOut"
            });
        }

        newsletterBtn.addEventListener('click', openPopup);
        closePopupBtn.addEventListener('click', closePopup);

        newsletterPopupOverlay.addEventListener('click', function (e) {
            if (e.target === newsletterPopupOverlay) {
                closePopup();
            }
        });
    }

    // --- Listen for the custom event to run the initialization ---
    document.addEventListener('newsletterPopupReady', initializePopup);
}); 